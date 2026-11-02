import { setGlobalOptions } from "firebase-functions/v2/options";

setGlobalOptions({
  region: "europe-west1",
  maxInstances: 10,
});

export {
  debugAuth,
  checkUsernameAvailability,
  bootstrapProfile,
  syncMyEmailVerification,
  recordVerificationSent,
} from "./auth";

export { updateProfile, setRelationship } from "./profile";
export { deleteMyAccount } from "./accountDeletion";

export {
  listTrapDefinitions,
  getMyTrapInventory,
  getMyActiveTraps,
  seedTrapDefinitions,
  startTrapPlacement,
  tapTrapPlacement,
  updatePlayerLocation,
  revealNearbyTrap,
  startTrapDisarm,
  tapTrapDisarm,
  disarmAndCollectTrap,
  dropTrapFromBag,
  resetDailyState,
  expireOldTraps,
  setHomeBase,
  removeHomeBase,
  getMyTrapStatisticsBundle,
  getMyPlacedTrapsDetailed,
  getMyCaptureHistoryDetailed,
  adminGetTrapStatisticsOverview,
  adminSearchTrapRecords,
  adminGetUserTrapStatistics,
  applyRefillAdReward,
} from "./traps";

export { refreshLeaderboard, getGlobalLeaderboard } from "./leaderboard";
export { setUserAdmin } from "./admin";

export {
  adminListUsers,
  adminSearchUsers,
  adminCreateUser,
  adminResendVerificationEmail,
  adminSyncEmailVerificationStatus,
  adminUpdateUsername,
  adminUpdateUserProfile,
  adminSetUserPassword,
  adminUpdateUserStatus,
  adminSetUserLevel,
  adminDeleteUser,
  adminResetUserTrapAvailability,
  adminBackfillAuthUsersToFirestore,
} from "./adminUsers";

export {
  adminGetGameSettings,
  adminUpdateGameSettings,
  getPublicGameSettings,
} from "./adminGameSettings";

export {
  adminListTrapDefinitions,
  adminCreateTrapDefinition,
  adminUpdateTrapDefinition,
  adminDeleteTrapDefinition,
  adminTranslateTrapTexts,
  adminListTraps,
  adminUpdateTrapStatus,
  adminDeleteTrap,
  adminGetTrapDetails,
  adminActivateTrap,
  adminDeactivateTrap,
  adminDeleteAllTraps,
  adminUpdateTrapTimers,
} from "./adminTraps";

export {
  adminListLevels,
  adminCreateLevel,
  adminUpdateLevel,
  adminDeleteLevel,
  seedDefaultLevels,
} from "./adminLevels";

export {
  adminGetGeneralSettings,
  adminUpdateGeneralSettings,
} from "./adminGeneralSettings";

export {
  adminListProgressionLevels,
  adminCreateProgressionLevel,
  adminUpdateProgressionLevel,
  adminDeleteProgressionLevel,
  seedDefaultProgressionLevels,
} from "./adminProgressionLevels";

export { adminDashboardMetrics, adminDashboardTotals } from "./adminDashboard";

export {
  adminCreateTrapGenJob,
  adminRunTrapGenJob,
  adminFetchCountryCities,
  triggerFirstLoginTrapGen,
  adminTriggerUserLocationTrapGen,
} from "./adminTrapGenerator";

export {
  adminGetUserGameData,
  adminDeleteUserTraps,
  adminResetUserScores,
  adminGetPlayerLocations,
} from "./adminUserData";

export {
  adminGetAuditLog,
  adminGetMyAdminProfile,
  adminUpdateMyAdminProfile,
} from "./adminAuditLog";

export {
  adminGetPaymentSettings,
  adminUpdatePaymentSettings,
  adminGetPaymentHistory,
  adminRefundPayment,
  adminGetRevolutSettings,
  adminUpdateRevolutSettings,
  adminRefundRevolutPayment,
  adminRegisterRevolutWebhook,
  adminCheckRevolutWebhooks,
} from "./adminPayments";

export {
  getPaymentConfig,
  createCheckoutSession,
  getUserPaymentHistory,
  cancelSubscription,
  stripeWebhook,
} from "./payments";

export {
  getAvailablePackages,
  getMySubscription,
  createRevolutCheckout,
  cancelMySubscription,
} from "./revolut/payments";

export { revolutWebhook } from "./revolut/webhook";
export { verifyPlayPurchase, playBillingRtdn } from "./playBilling";

export {
  createDonation,
  getSuggestedDonationAmounts,
  adminGetDonations,
} from "./revolut/donations";

export {
  adminListPaymentPackages,
  adminCreatePaymentPackage,
  adminUpdatePaymentPackage,
  adminDeletePaymentPackage,
  adminAddDiscount,
  adminRemoveDiscount,
  adminListSubscriptions,
  adminCancelSubscription,
} from "./adminPaymentPackages";

export {
  scheduledMembershipCheck,
  adminVerifyMemberships,
  adminSyncUserMembership,
} from "./membershipGuard";

export {
  getTermsAndConditions,
  adminGetTermsAndConditions,
  adminUpdateTermsAndConditions,
  adminTranslateTermsContent,
} from "./appContent";

export {
  sendFriendRequest,
  acceptFriendRequest,
  removeFriend,
  listFriends,
  listFriendRequests,
  createAllyGroup,
  inviteToAllyGroup,
  acceptAllyGroupInvite,
  leaveAllyGroup,
  listMyAllyGroups,
  listAllyGroupMembers,
  generateInviteLink,
  getInviteConfig,
  claimReferral,
} from "./social";

export {
  getFriendsLeaderboard,
  getAllyGroupLeaderboard,
  getMyRankSummary,
} from "./leaderboardsSocial";

export {
  createSupportTicket,
  listMySupportTickets,
  getSupportTicketThread,
  replyToSupportTicket,
  adminListSupportTickets,
  adminGetSupportStats,
  adminGetSupportTicketThread,
  adminReplyToSupportTicket,
} from "./support";

export {
  setMyUsername,
  getMyMessagingProfile,
  sendDirectMessageByUsername,
  sendDirectMessageToUid,
  searchUsersByUsername,
  sendFriendRequestByUsername,
  listMyConversations,
  getConversationThread,
} from "./messages";

export {
  getUserMiniProfile,
  listFriendRequestsDetailed,
  respondToFriendRequest as respondToFriendRequestDetailed,
  listMyFriendsDetailed,
  getFriendshipStatusByUsername,
  findUserByIdentifier,
} from "./socialExtras";

export {
  getMyTrapStats,
  listMyCaptures,
  listPlayersWhoCapturedMe,
  getTrapCaptureDetails,
} from "./trapStats";

export {
  createAllyGroupV2,
  inviteToAllyGroupV2,
  acceptAllyGroupInviteV2,
  listAllyGroupMembersWithRoles,
  listAllyGroupRoles,
  createAllyGroupRole,
  updateAllyGroupRole,
  deleteAllyGroupRole,
  assignAllyGroupMemberRole,
  transferAllyGroupLeadership,
  declareEnemyRelation,
  removeEnemyRelation,
  listEnemyRelations,
} from "./allyDiplomacy";

export { listNearbyUsers } from "./nearbyUsers";

export {
  adminGetTrapResultsLeaderboard,
  getPublicTrapResultsLeaderboard,
} from "./trapResults";

export { adminRecalculateUserPoints } from "./adminRecalculatePoints";

export { claimAdReward, adMobSsvWebhook } from "./claimAdReward";

export {
  getAppTranslations,
  adminGetAllTranslations,
  adminUpdateAppTranslations,
  adminImportXmlTranslations,
  adminAiTranslateStrings,
  adminSetAiApiKey,
  adminCheckAiApiKey,
  adminGetSupportedLanguages,
  adminAddLanguage,
  adminRemoveLanguage,
} from "./adminAppTranslations";

export {
  adminGetEmailAutomationSettings,
  adminUpdateEmailAutomationSettings,
  adminTriggerInactivityEmails,
  scheduledInactivityEmails,
} from "./adminEmailAutomation";

export {
  claimLoginReward,
  claimHourlyDay1Reward,
  useCard,
  getUserInventory,
} from "./awards";

export {
  getAwardsContent,
  adminGetAwardsContent,
  adminUpdateAwardsContent,
  adminTranslateAwardsContent,
} from "./awardsContent";

export {
  adminListAwardDefinitions,
  adminCreateAwardDefinition,
  adminUpdateAwardDefinition,
  adminDeleteAwardDefinition,
  adminSeedDefaultAwards,
  adminGetUserInventory,
  adminGrantCards,
} from "./adminAwards";

export {
  sendPasswordResetCustom,
  sendEmailVerificationCustom,
  adminListEmailTemplates,
  adminGetEmailTemplate,
  adminSaveEmailTemplate,
  adminDeleteEmailTemplate,
  adminSendTestEmail,
  adminSendNewsletter,
  adminSeedSystemTemplates,
  adminAiTranslateEmailTemplate,
} from "./adminEmailTemplates";