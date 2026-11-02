# Fixtures

```
fixtures/
  synthetic/   fake sample cards made by `make fixtures`, used by the tests
  real/        real cards for local testing only, ignored by git
```

Don't commit real ID cards. They contain personal data. To measure on real cards, put them in
`real/` with a `manifest.json` and run `make measure-real` (the folder is mounted read-only).

If you want to share a real test set, anonymise it first: change the ID number to a valid but made
up one, replace the name and address with text of the same length, and cover the photo. Leave the
background, glare and angle as they are.

## Manifest format

```json
[
  {
    "id": "real-001",
    "front": "real-001-front.jpg",
    "back": "real-001-back.jpg",
    "quality": "harsh",
    "source": "real-anonymized",
    "truth": {
      "fullNameAr": "…",
      "address": "…",
      "nationalId": "29001011201234",
      "occupation": "…",
      "religion": "مسلم",
      "maritalStatus": "متزوج",
      "nationalIdExpiry": "2030-05-12"
    }
  }
]
```

Write the truth exactly as printed on the card. Fields a card doesn't have can be left out.
Run `make check FIXTURES=fixtures/real` before measuring to make sure each field box lands on text.
