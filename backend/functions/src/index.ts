import { setGlobalOptions } from "firebase-functions/v2/options";

setGlobalOptions({
  region: "europe-west1",
  maxInstances: 10,
});

/**
 * Every function runs in its own Cloud Run service, but each one used to load all modules (and
 * their SDKs) on a cold start. A deployed instance knows its own entry point (FUNCTION_TARGET,
 * or the lower-cased service name K_SERVICE), so it only loads the module that defines it.
 * Without a match (deploy-time discovery, emulator, tests) every module is loaded as before.
 * Entries are export names; "exported=source" re-exports under another name.
 */
const MODULES: Array<[() => Record<string, unknown>, string[]]> = [
  [() => require("./auth"), [
    "debugAuth", "checkUsernameAvailability", "bootstrapProfile", "syncMyEmailVerification",
    "recordVerificationSent",
  ]],
  [() => require("./profile"), [
    "updateProfile", "setRelationship",
  ]],
  [() => require("./accountDeletion"), [
    "deleteMyAccount",
  ]],
  [() => require("./traps"), [
    "listTrapDefinitions", "getMyTrapInventory", "getMyActiveTraps", "seedTrapDefinitions",
    "startTrapPlacement", "tapTrapPlacement", "updatePlayerLocation", "revealNearbyTrap",
    "startTrapDisarm", "tapTrapDisarm", "disarmAndCollectTrap", "dropTrapFromBag",
    "resetDailyState", "expireOldTraps", "setHomeBase", "removeHomeBase",
    "getMyTrapStatisticsBundle", "getMyPlacedTrapsDetailed", "getMyCaptureHistoryDetailed",
    "adminGetTrapStatisticsOverview", "adminSearchTrapRecords", "adminGetUserTrapStatistics",
    "applyRefillAdReward",
  ]],
  [() => require("./leaderboard"), [
    "refreshLeaderboard", "getGlobalLeaderboard",
  ]],
  [() => require("./admin"), [
    "setUserAdmin",
  ]],
  [() => require("./adminUsers"), [
    "adminListUsers", "adminSearchUsers", "adminCreateUser", "adminResendVerificationEmail",
    "adminSyncEmailVerificationStatus", "adminUpdateUsername", "adminUpdateUserProfile",
    "adminSetUserPassword", "adminUpdateUserStatus", "adminSetUserLevel", "adminDeleteUser",
    "adminResetUserTrapAvailability", "adminBackfillAuthUsersToFirestore",
  ]],
  [() => require("./adminGameSettings"), [
    "adminGetGameSettings", "adminUpdateGameSettings", "getPublicGameSettings",
  ]],
  [() => require("./adminTraps"), [
    "adminListTrapDefinitions", "adminCreateTrapDefinition", "adminUpdateTrapDefinition",
    "adminDeleteTrapDefinition", "adminTranslateTrapTexts", "adminListTraps",
    "adminUpdateTrapStatus", "adminDeleteTrap", "adminGetTrapDetails", "adminActivateTrap",
    "adminDeactivateTrap", "adminDeleteAllTraps", "adminUpdateTrapTimers",
  ]],
  [() => require("./adminLevels"), [
    "adminListLevels", "adminCreateLevel", "adminUpdateLevel", "adminDeleteLevel",
    "seedDefaultLevels",
  ]],
  [() => require("./adminGeneralSettings"), [
    "adminGetGeneralSettings", "adminUpdateGeneralSettings",
  ]],
  [() => require("./adminProgressionLevels"), [
    "adminListProgressionLevels", "adminCreateProgressionLevel", "adminUpdateProgressionLevel",
    "adminDeleteProgressionLevel", "seedDefaultProgressionLevels",
  ]],
  [() => require("./adminDashboard"), [
    "adminDashboardMetrics", "adminDashboardTotals",
  ]],
  [() => require("./adminTrapGenerator"), [
    "adminCreateTrapGenJob", "adminRunTrapGenJob", "adminFetchCountryCities",
    "triggerFirstLoginTrapGen", "adminTriggerUserLocationTrapGen",
  ]],
  [() => require("./adminUserData"), [
    "adminGetUserGameData", "adminDeleteUserTraps", "adminResetUserScores",
    "adminGetPlayerLocations",
  ]],
  [() => require("./adminAuditLog"), [
    "adminGetAuditLog", "adminGetMyAdminProfile", "adminUpdateMyAdminProfile",
  ]],
  [() => require("./adminPayments"), [
    "adminGetPaymentSettings", "adminUpdatePaymentSettings", "adminGetPaymentHistory",
    "adminRefundPayment", "adminGetRevolutSettings", "adminUpdateRevolutSettings",
    "adminRefundRevolutPayment", "adminRegisterRevolutWebhook", "adminCheckRevolutWebhooks",
  ]],
  [() => require("./payments"), [
    "getPaymentConfig", "createCheckoutSession", "getUserPaymentHistory", "cancelSubscription",
    "stripeWebhook",
  ]],
  [() => require("./revolut/payments"), [
    "getAvailablePackages", "getMySubscription", "createRevolutCheckout", "cancelMySubscription",
  ]],
  [() => require("./revolut/webhook"), [
    "revolutWebhook",
  ]],
  [() => require("./playBilling"), [
    "verifyPlayPurchase", "playBillingRtdn",
  ]],
  [() => require("./revolut/donations"), [
    "createDonation", "getSuggestedDonationAmounts", "adminGetDonations",
  ]],
  [() => require("./adminPaymentPackages"), [
    "adminListPaymentPackages", "adminCreatePaymentPackage", "adminUpdatePaymentPackage",
    "adminDeletePaymentPackage", "adminAddDiscount", "adminRemoveDiscount",
    "adminListSubscriptions", "adminCancelSubscription",
  ]],
  [() => require("./membershipGuard"), [
    "scheduledMembershipCheck", "adminVerifyMemberships", "adminSyncUserMembership",
  ]],
  [() => require("./appContent"), [
    "getTermsAndConditions", "adminGetTermsAndConditions", "adminUpdateTermsAndConditions",
    "adminTranslateTermsContent",
  ]],
  [() => require("./social"), [
    "sendFriendRequest", "acceptFriendRequest", "removeFriend", "listFriends", "listFriendRequests",
    "createAllyGroup", "inviteToAllyGroup", "acceptAllyGroupInvite", "leaveAllyGroup",
    "listMyAllyGroups", "listAllyGroupMembers", "generateInviteLink", "getInviteConfig",
    "claimReferral",
  ]],
  [() => require("./leaderboardsSocial"), [
    "getFriendsLeaderboard", "getAllyGroupLeaderboard", "getMyRankSummary",
  ]],
  [() => require("./support"), [
    "createSupportTicket", "listMySupportTickets", "getSupportTicketThread", "replyToSupportTicket",
    "adminListSupportTickets", "adminGetSupportStats", "adminGetSupportTicketThread",
    "adminReplyToSupportTicket",
  ]],
  [() => require("./messages"), [
    "setMyUsername", "getMyMessagingProfile", "sendDirectMessageByUsername",
    "sendDirectMessageToUid", "searchUsersByUsername", "sendFriendRequestByUsername",
    "listMyConversations", "getConversationThread",
  ]],
  [() => require("./socialExtras"), [
    "getUserMiniProfile", "listFriendRequestsDetailed",
    "respondToFriendRequestDetailed=respondToFriendRequest", "listMyFriendsDetailed",
    "getFriendshipStatusByUsername", "findUserByIdentifier",
  ]],
  [() => require("./trapStats"), [
    "getMyTrapStats", "listMyCaptures", "listPlayersWhoCapturedMe", "getTrapCaptureDetails",
  ]],
  [() => require("./allyDiplomacy"), [
    "createAllyGroupV2", "inviteToAllyGroupV2", "acceptAllyGroupInviteV2",
    "listAllyGroupMembersWithRoles", "listAllyGroupRoles", "createAllyGroupRole",
    "updateAllyGroupRole", "deleteAllyGroupRole", "assignAllyGroupMemberRole",
    "transferAllyGroupLeadership", "declareEnemyRelation", "removeEnemyRelation",
    "listEnemyRelations",
  ]],
  [() => require("./nearbyUsers"), [
    "listNearbyUsers",
  ]],
  [() => require("./trapResults"), [
    "adminGetTrapResultsLeaderboard", "getPublicTrapResultsLeaderboard",
  ]],
  [() => require("./adminRecalculatePoints"), [
    "adminRecalculateUserPoints",
  ]],
  [() => require("./claimAdReward"), [
    "claimAdReward", "adMobSsvWebhook",
  ]],
  [() => require("./adminAppTranslations"), [
    "getAppTranslations", "adminGetAllTranslations", "adminUpdateAppTranslations",
    "adminImportXmlTranslations", "adminAiTranslateStrings", "adminSetAiApiKey",
    "adminCheckAiApiKey", "adminGetSupportedLanguages", "adminAddLanguage", "adminRemoveLanguage",
  ]],
  [() => require("./adminEmailAutomation"), [
    "adminGetEmailAutomationSettings", "adminUpdateEmailAutomationSettings",
    "adminTriggerInactivityEmails", "scheduledInactivityEmails",
  ]],
  [() => require("./awards"), [
    "claimLoginReward", "claimHourlyDay1Reward", "useCard", "getUserInventory",
  ]],
  [() => require("./awardsContent"), [
    "getAwardsContent", "adminGetAwardsContent", "adminUpdateAwardsContent",
    "adminTranslateAwardsContent",
  ]],
  [() => require("./adminAwards"), [
    "adminListAwardDefinitions", "adminCreateAwardDefinition", "adminUpdateAwardDefinition",
    "adminDeleteAwardDefinition", "adminSeedDefaultAwards", "adminGetUserInventory",
    "adminGrantCards",
  ]],
  [() => require("./adminEmailTemplates"), [
    "sendPasswordResetCustom", "sendEmailVerificationCustom", "adminListEmailTemplates",
    "adminGetEmailTemplate", "adminSaveEmailTemplate", "adminDeleteEmailTemplate",
    "adminSendTestEmail", "adminSendNewsletter", "adminSeedSystemTemplates",
    "adminAiTranslateEmailTemplate",
  ]],
  [() => require("./adminPerformance"), [
    "adminGetKeepWarm", "adminSetKeepWarm", "reconcileKeepWarm",
  ]],
];

const target = process.env.FUNCTION_TARGET ?? "";
const service = (process.env.K_SERVICE ?? "").toLowerCase();
const exportName = (entry: string) => entry.split("=")[0];
const own = MODULES.filter(([, names]) =>
  names.some((n) => exportName(n) === target || exportName(n).toLowerCase() === service)
);

for (const [load, names] of own.length > 0 ? own : MODULES) {
  const mod = load();
  for (const entry of names) {
    const [exported, source = exported] = entry.split("=");
    exports[exported] = mod[source];
  }
}
