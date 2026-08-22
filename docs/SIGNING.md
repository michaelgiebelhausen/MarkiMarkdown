# Signing MarkiMarkdown for Windows

Without a signature, Windows treats MarkiMarkdown as an unknown program. Most students see one
"Windows protected your PC" screen and click past it. A few, on Windows 11 PCs with **Smart App Control**
turned on, see the app refuse to start the first time while Windows makes up its mind about it.

Signing removes both. This is the fastest route.

## Azure Trusted Signing (about $10 a month)

Microsoft's own service. It issues short-lived certificates from a CA that Windows already trusts, so a signed
build is accepted immediately rather than having to build up a reputation.

### One-time setup

1. **Create the account.** In the [Azure portal](https://portal.azure.com), search for **Trusted Signing** and
   create a Trusted Signing Account. Pick the region closest to you and note the endpoint it gives you, for
   example `https://eus.codesigning.azure.net/`.

2. **Complete identity validation.** Under the account, start identity validation. Individual validation asks
   for government ID; organisation validation asks for business records. This is the slow part - allow a few
   business days. Nothing else can proceed until it says **Completed**.

3. **Create a certificate profile.** Once validation passes, create a certificate profile of type
   **Public Trust**. Note its name.

   The name on the certificate becomes the publisher students see. For individual validation it is your own
   name, so decide now whether you are comfortable with that being visible on every download.

4. **Create credentials for the build machine.** In Microsoft Entra ID, register an application and create a
   client secret. Then, on the Trusted Signing account, assign that application the
   **Trusted Signing Certificate Profile Signer** role.

5. **Set four environment variables** on whichever machine builds the installer:

   ```
   AZURE_TENANT_ID       from the app registration
   AZURE_CLIENT_ID       from the app registration
   AZURE_CLIENT_SECRET   the secret you created
   MARKI_PUBLISHER       the exact subject name on the certificate profile
   ```

   Plus these three, which describe where to sign:

   ```
   MARKI_SIGN_ENDPOINT   e.g. https://eus.codesigning.azure.net/
   MARKI_SIGN_ACCOUNT    the Trusted Signing account name
   MARKI_SIGN_PROFILE    the certificate profile name
   ```

### Building a signed installer

```
npm run pack:win:signed
```

That is the same build as `npm run pack:win`, with signing switched on. If any of the variables above are
missing the build fails rather than quietly producing an unsigned file.

### Checking it worked

```
powershell -Command "Get-AuthenticodeSignature .\dist\win-unpacked\MarkiMarkdown.exe | Format-List Status, SignerCertificate"
```

`Status` must read `Valid`. If it says `NotSigned`, the environment variables were not picked up.

## While you wait

Ship the unsigned build. It works - `docs/INSTALL.md` walks students through the warning in plain language.
Sign the next release once validation completes; students who already have it installed will get the signed
version the next time they update.

## Notes

- Azure's requirements and portal wording change from time to time. If a step above does not match what you
  see, follow the [Trusted Signing documentation](https://learn.microsoft.com/azure/trusted-signing/) and
  update this file.
- Never commit the client secret. It belongs in environment variables, or in GitHub Actions secrets if you
  build releases there.
- macOS signing is separate and uses your Apple Developer account: see `pack:mac` in `package.json`.

---

# Signing MarkiMarkdown for macOS

macOS refuses to open a downloaded app unless it is signed and notarised, and there is no "run anyway" for
most students. This part is not optional if you want Mac users in your class.

## You need a "Developer ID Application" certificate

Apple issues several kinds of certificate and they are not interchangeable:

| Certificate | What it is for |
| --- | --- |
| iPhone Distribution | iOS apps sent to the App Store. **Not this one.** |
| Apple Development | Testing on your own devices. Not this one either. |
| Mac App Store | Apps sold through the Mac App Store. |
| **Developer ID Application** | **Apps people download from you directly. This is the one.** |

Only the Account Holder on the Apple Developer Program membership can create a Developer ID certificate.

## You do not need a Mac

The release workflow in `.github/workflows/release.yml` builds and notarises on GitHub's macOS runners, which
are free for public repositories. Everything below can be done from Windows.

### 1. The signing request

Already generated for you at `C:\Users\boh56\marki-signing\`:

- `developerID.csr` - upload this to Apple
- `developerID.key` - **the private key. Never commit it, never email it, never paste it anywhere.**

To regenerate it later:

```
openssl req -new -newkey rsa:2048 -nodes -keyout developerID.key -out developerID.csr -subj "/CN=Your Name/C=US"
```

### 2. Get the certificate from Apple

1. Go to [developer.apple.com/account/resources/certificates](https://developer.apple.com/account/resources/certificates).
2. Press **+**, choose **Developer ID Application**, and continue.
3. Upload `developerID.csr` when asked for a Certificate Signing Request.
4. Download the resulting `.cer` into the same folder.

### 3. Combine them into a .p12

Signing needs the certificate and its private key together in one file:

```
openssl x509 -inform DER -in developerID_application.cer -out developerID.pem
openssl pkcs12 -export -inkey developerID.key -in developerID.pem -out developerID.p12
```

It asks for an export password. Choose one and keep it - that becomes `CSC_KEY_PASSWORD`.

### 4. An app-specific password for notarising

Apple will not accept your normal Apple ID password here. Go to
[account.apple.com](https://account.apple.com), sign in, and under **Sign-In and Security** create an
**App-Specific Password**. Copy it; Apple will not show it again.

### 5. Add the secrets

Turn the `.p12` into text so it can live in a secret:

```
openssl base64 -A -in developerID.p12 -out developerID.p12.base64
```

Then, in the GitHub repository under **Settings > Secrets and variables > Actions**, add:

| Secret | Value |
| --- | --- |
| `CSC_LINK` | the contents of `developerID.p12.base64` |
| `CSC_KEY_PASSWORD` | the export password from step 3 |
| `APPLE_ID` | your Apple ID email address |
| `APPLE_APP_SPECIFIC_PASSWORD` | the password from step 4 |
| `APPLE_TEAM_ID` | your ten-character Team ID |

Your Team ID is on the certificate you already have, and on the
[membership page](https://developer.apple.com/account) of your developer account.

### 6. Release

Push a tag. The workflow builds, signs, sends the app to Apple to be notarised, staples the result, and
attaches the `.dmg` to a draft release. The first notarisation can take a few minutes; later ones are quicker.

## Keeping the secrets safe

`developerID.key`, `developerID.p12` and the base64 file are all outside the repository on purpose. Keep them
somewhere you back up, but never in git and never in a chat window. If one leaks, revoke the certificate in
your Apple developer account and make a new one - it takes about five minutes.
