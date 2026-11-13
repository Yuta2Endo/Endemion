// GET /api/config — публичные настройки для браузера. Секреты сюда не попадают

import { json } from "../_lib/http.js";
import { accountUrl, endemionIdEnabled } from "../_lib/endemionId.js";
import { adsPageId } from "../_lib/ads.js";
import { mailConfigured } from "../_lib/mail.js";
import { getSettings } from "../_lib/studio.js";
import { langOf, t } from "../_lib/i18n.js";

const ACCOUNT_KEYS = [
  "accountTitle",
  "accountEyebrow",
  "accountNavOverview",
  "accountNavCharacters",
  "accountNavAchievements",
  "accountNavFamily",
  "accountNavSettings",
  "accountNavSecurity",
  "accountPlayLife",
  "accountLogout",
  "accountPlayer",
  "accountPlayerSince",
  "accountPlayerStatus",
  "accountProviderLocal",
  "accountProviderEndemionId",
  "accountEditProfile",
  "accountStats",
  "accountStatsAchievements",
  "accountStatsTopics",
  "accountStatsPosts",
  "accountStatsFollowers",
  "accountStatsFollowing",
  "accountSaves",
  "accountSaveSync",
  "accountSaveSyncPending",
  "accountSaveNoData",
  "accountSaveOpenLife",
  "accountOnboardingTitle",
  "accountOnboardingLead",
  "accountOnboardingProgress",
  "accountOnboardingStepAvatar",
  "accountOnboardingStepBio",
  "accountOnboardingStepGame",
  "accountOnboardingStepTopic",
  "accountOnboardingGo",
  "accountOnboardingHide",
  "accountOnboardingDone",
  "accountOnboardingHidden",
  "accountCharacters",
  "accountCharactersDesc",
  "accountCharactersEmptyTitle",
  "accountCharactersEmptyText",
  "accountAchievements",
  "accountAchievementsDesc",
  "accountAchievementLocked",
  "accountAchievementEarned",
  "accountFamily",
  "accountFamilyDesc",
  "accountFamilyEmptyTitle",
  "accountFamilyEmptyText",
  "accountSettings",
  "accountSettingsDesc",
  "accountSettingsProfile",
  "accountSettingsName",
  "accountSettingsBio",
  "accountSettingsAvatarColor",
  "accountSettingsAvatar",
  "accountSettingsAvatarUpload",
  "accountSettingsAvatarRemove",
  "accountSettingsAvatarHint",
  "accountSettingsSaveProfile",
  "accountSettingsPrivacy",
  "accountSettingsPrivacyPublic",
  "accountSettingsPrivacyActivity",
  "accountSettingsSavePrivacy",
  "accountSettingsNotifications",
  "accountSettingsNotifyReplies",
  "accountSettingsNotifyFollows",
  "accountSettingsNotifyAchievements",
  "accountSettingsSaveNotifications",
  "accountSettingsEndemionId",
  "accountSettingsEndemionIdText",
  "accountSettingsOpenEndemionId",
  "accountSecurity",
  "accountSecurityDesc",
  "accountSecurityProvider",
  "accountSecurityAccountType",
  "accountSecurityEmail",
  "accountSecurityRegistered",
  "accountSecurityLastAuth",
  "accountSecuritySessions",
  "accountSecuritySessionCurrent",
  "accountSecuritySessionTerminate",
  "accountSecurityCannotTerminateCurrent",
  "accountSecuritySessionNotFound",
  "accountSecuritySessionDeleted",
  "accountSecurityNoSessions",
  "accountProfileSaved",
  "accountProfileSaveError",
  "accountPrivacySaved",
  "accountPrivacyPublicText",
  "accountPrivacyPrivateText",
  "accountNotifySaved",
  "accountNotifySaveError",
  "accountAvatarLoaded",
  "accountAvatarLoadError",
  "accountAvatarRemoved",
  "accountAvatarRemoveError",
  "accountStatsEmptyTitle",
    "accountStatsEmptyText",
    "accountSubmitSaving",
    "accountNameHintEndemionId",
    "accountAvatarValidationType",
    "accountAvatarValidationSize",
    "accountAvatarUploading",
    "accountSaveFailed",
  ];

export async function onRequestGet({ env, request }) {
  const metrika = String(env.YANDEX_METRIKA_ID || "").trim();
  let socialLinks = [];
  try {
    socialLinks = (await getSettings(env)).socialLinks;
  } catch {}
  const lang = langOf(request);
  const account = {};
  for (const key of ACCOUNT_KEYS) {
    account[key] = t(lang)[key] || key;
  }
  return json(
    {
      turnstileSiteKey: env.TURNSTILE_SITE_KEY || "",
      webAnalyticsToken: env.WEB_ANALYTICS_TOKEN || "",
      yandexMetrikaId: /^\d{5,12}$/.test(metrika) ? metrika : "",
      yandexAdsPageId: adsPageId(env),
      passwordReset: mailConfigured(env, request),
      socialLinks,
      endemionId: endemionIdEnabled(env) ? { account: accountUrl(env), life: env.ENDEMION_LIFE_URL || "https://life.endemion.online" } : null,
      account,
    },
    200,
    { "Cache-Control": "public, max-age=300" }
  );
}
