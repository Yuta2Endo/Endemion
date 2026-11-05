# GOOGLE PLAY — LEGAL SETUP

Guide for publishing the Endemion games' legal documents in Google Play Console.
Prepared 2026-11-05 on branch `feature/legal-center`.

> **Status of the URLs.** The routes below are implemented and tested locally, but they are **not deployed yet**: in production `https://endemion.online/legal` currently returns 404. Enter them in Play Console only after the branch is merged and deployed, and after the checks in section 3 pass.

> Developer name (**Endemion**), contact email (**endemion@internet.ru**) and minimum age (**18+**) are filled in, which covers what Google Play requires. Other highlighted placeholders remain (postal address, governing law, retention periods), so pages still show the Draft banner. These documents are templates based on the code, not legal advice.

## 1. URLs per game

| Game | Platform | Package | Privacy Policy | Terms of Service |
|---|---|---|---|---|
| TETRUS | Android | `endemion.tetrus` | `https://endemion.online/legal/tetrus/privacy-policy` | `https://endemion.online/legal/tetrus/terms-of-service` |
| Little Weather | Android | `endemion.littleweather` | `https://endemion.online/legal/little-weather/privacy-policy` | `https://endemion.online/legal/little-weather/terms-of-service` |
| Liforae | Android | `com.liforae.game` | `https://endemion.online/legal/liforae/privacy-policy` | `https://endemion.online/legal/liforae/terms-of-service` |
| BLOCK CITY | Android | `org.blockcity.game` | `https://endemion.online/legal/block-city/privacy-policy` | `https://endemion.online/legal/block-city/terms-of-service` |
| ENDEMION LIFE | Web (life.endemion.online) | — | `https://endemion.online/legal/endemion-life/privacy-policy` | `https://endemion.online/legal/endemion-life/terms-of-service` |

- The default language is Russian. Add `?lang=en` for English, for example `https://endemion.online/legal/tetrus/privacy-policy?lang=en`.
- For a store listing aimed at all countries, use the English URL. A Russian-only listing can use the URL without `?lang=en`.
- ENDEMION LIFE is a browser game and has no Play listing. Its documents are for the website and for a link from inside the game.

## 2. Adding the Privacy Policy in Play Console

For each Android game:

1. Open Play Console → select the app.
2. **Policy and programs → App content → Privacy policy** → **Start** (or **Manage**).
3. Paste the Privacy Policy URL from the table → **Save**.
4. In **Store presence → Store settings**, check that the contact email is filled in. It should match the email you put in the policy.
5. Optional: add a link to the policy inside the game (settings or about screen). None of the three games has one yet.

The Terms of Service URL is not a required Play Console field. Link it from the store description or from the game if you want users to see it.

## 3. Verifying the public URL

Google's reviewers must be able to open the page without logging in, from any country. After deploy, check every URL:

```sh
for g in tetrus little-weather liforae block-city endemion-life; do
  for d in privacy-policy terms-of-service; do
    for q in "" "?lang=en"; do
      u="https://endemion.online/legal/$g/$d$q"
      printf '%s %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "$u")" "$u"
    done
  done
done
```

Every line must start with `200`. Then, in a private browser window:

- the page opens without signing in and shows the game name, the document type and the last-updated date;
- no highlighted placeholder is left in the sections Google checks (developer name, contact email);
- the page is not a PDF or a file download, and it opens on a phone.

The pages are indexable (no `noindex`) and are listed in `https://endemion.online/sitemap.xml`.

## 4. Consistency with the Data Safety form

Google compares the Data Safety form with the app and the policy. The answers below follow from the code audit (`LEGAL_CENTER_AUDIT.md` §2). **Re-check them on the release build**: the audit was done on debug builds, and a release build with a different template, plugin or SDK can add permissions or network access.

### TETRUS, Little Weather, Liforae

| Data Safety question | Answer per code | Where it is stated in the policy |
|---|---|---|
| Does your app collect or share any of the required user data types? | **No** | "Summary", "Automatically collected information" |
| Is all user data encrypted in transit? | Not applicable: no data leaves the device | "Data security" |
| Do you provide a way for users to request that their data be deleted? | Data is only on the device; deletion via uninstall or Clear storage | "Data deletion" |

Notes:

- Data stored only on the device and never sent off it is not "collected" in Google's definition, so "No data collected" is consistent with the policy.
- Liforae stores the character name the player types. It stays on the device, so it is still not collected.
- **Permissions to declare.** TETRUS and Little Weather request only `VIBRATE`. Liforae requests none. If the release manifest shows anything else (especially `INTERNET`), update the policy before publishing.
- **Ads.** All three games answer "No, my app does not contain ads".
- **Target audience and content.** The documents say 18+ for every game, so in Play Console → App content → Target audience select **only 18 and over** for each game. Then the Families policy does not apply. Complete the IARC questionnaire honestly (Liforae: tobacco, simulated lottery); the IARC rating is separate from the target audience and may come out lower than 18.

### ENDEMION LIFE (if it is ever wrapped as an app)

It is a website, so no Data Safety form is needed today. If it ever ships as an Android app, the form would have to declare at least: email address, name, user IDs, app interactions (game actions), and device or other IDs (the session cookie). The policy already describes these.

## 5. Developer details still needed

Fill these in before publishing (they appear as highlighted placeholders):

| Field | Used in | Required for Google Play |
|---|---|---|
| ~~Developer's legal name~~ — filled: Endemion | all documents | **Yes** |
| ~~Contact email~~ — filled: endemion@internet.ru | all documents | **Yes** |
| Postal address (if published) | all documents | Recommended (Google may require an address for paid apps) |
| ~~Minimum age~~ — filled: 18+ for all games | Terms, Children's privacy | **Yes**, must match the Target audience setting |
| Governing law, courts | Terms | No |
| Developer refund terms | Terms | No (no purchases) |
| Email retention period (email provider filled: Mail.ru, from the address domain) | offline-game policies | No |
| Data-breach notification procedure, log/backup/guest retention periods, transfer mechanism | ENDEMION LIFE policy | Not for Play |

Placeholders live in `functions/_lib/legal/common.js` (shared) and in each game's file in `functions/_lib/legal/`. When they are all filled in, the "Draft" banner disappears from the page by itself. Change `LEGAL_UPDATED` in `functions/_lib/legal/index.js` whenever the texts change.

## 6. Checklist per Android game

- [x] Developer name, email and minimum age filled in.
- [ ] Branch deployed.
- [ ] All 4 URLs of the game return `200` (section 3).
- [ ] Release build manifest re-checked: permissions unchanged, no new SDKs.
- [ ] Play Console → App content → Privacy policy URL saved.
- [ ] Data Safety form filled in as in section 4.
- [ ] Ads declaration: "No ads".
- [ ] Target audience set to 18+ only, matching the Terms.
- [ ] IARC content rating questionnaire completed (Liforae: tobacco, lottery, death, romance).
- [ ] Store listing contact email matches the policy.
