# OTA code-signing credentials

Generated locally with:

```bash
npx expo-updates codesigning:generate \
  --key-output-directory credentials \
  --certificate-output-directory credentials \
  --certificate-validity-duration-years 10 \
  --certificate-common-name "sonoQui OTA Code Signing"
```

- `certificate.pem` — public cert, **committed** to git (a `!credentials/certificate.pem`
  exception in `.gitignore` overrides the blanket `*.pem` rule). Referenced by
  `app.json > updates.codeSigningCertificate` and bundled into the binary so the
  app can verify update signatures.
- `private-key.pem` — **never committed** (`*.pem` gitignore). Used by
  `eoas publish` to sign bundles, and copied to the server at
  `/opt/sonoqui/ota/keys/private-key.pem` (chmod 600).
- `public-key.pem` — also gitignored; lives server-side at
  `/opt/sonoqui/ota/keys/public-key.pem`.

Re-generating these rotates the signing chain — it requires a fresh native
build submitted to the stores, because binaries already in the field trust the
old cert and will reject updates signed by the new key. See the rotation steps
in [`../OTA.md`](../OTA.md).
