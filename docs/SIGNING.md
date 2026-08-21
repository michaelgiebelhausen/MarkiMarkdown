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
