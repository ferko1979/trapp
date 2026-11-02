import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";

export const adminGetTrapStatisticsOverview = () =>
  httpsCallable(functions, "adminGetTrapStatisticsOverview")({});

export const adminSearchTrapRecords = (payload: {
  scope: string;
  ownerUid?: string;
  capturedUserId?: string;
  trapStatus?: string;
  captureType?: string;
  limit?: number;
}) => httpsCallable(functions, "adminSearchTrapRecords")(payload);

export const adminGetUserTrapStatistics = (payload: { uid: string }) =>
  httpsCallable(functions, "adminGetUserTrapStatistics")(payload);