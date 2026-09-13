/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accountDeletion from "../accountDeletion.js";
import type * as archiveMultiChat from "../archiveMultiChat.js";
import type * as audioOverviewInterjections from "../audioOverviewInterjections.js";
import type * as audioOverviewInterjectionsV2 from "../audioOverviewInterjectionsV2.js";
import type * as audioOverviewJobUploadActions from "../audioOverviewJobUploadActions.js";
import type * as audioOverviewJobs from "../audioOverviewJobs.js";
import type * as audioOverviewRooms from "../audioOverviewRooms.js";
import type * as audioOverviewUploadActions from "../audioOverviewUploadActions.js";
import type * as audioOverviewUploads from "../audioOverviewUploads.js";
import type * as audioOverviewV2 from "../audioOverviewV2.js";
import type * as audioOverviews from "../audioOverviews.js";
import type * as auth from "../auth.js";
import type * as calendarConnections from "../calendarConnections.js";
import type * as calendarEventCleanup from "../calendarEventCleanup.js";
import type * as calendarEvents from "../calendarEvents.js";
import type * as contentFlags from "../contentFlags.js";
import type * as conversations from "../conversations.js";
import type * as courseDeletion from "../courseDeletion.js";
import type * as courseSections from "../courseSections.js";
import type * as courseSourceDocs from "../courseSourceDocs.js";
import type * as courses from "../courses.js";
import type * as crons from "../crons.js";
import type * as dataExport from "../dataExport.js";
import type * as documentActions from "../documentActions.js";
import type * as documentImports from "../documentImports.js";
import type * as documents from "../documents.js";
import type * as flashcardRooms from "../flashcardRooms.js";
import type * as folderIcons from "../folderIcons.js";
import type * as folderPalette from "../folderPalette.js";
import type * as folders from "../folders.js";
import type * as http from "../http.js";
import type * as learnProfile from "../learnProfile.js";
import type * as learnV2Access from "../learnV2Access.js";
import type * as learnV2FolderManifests from "../learnV2FolderManifests.js";
import type * as learnV2Lifecycle from "../learnV2Lifecycle.js";
import type * as learnV2Retention from "../learnV2Retention.js";
import type * as lib_accountDeletionTombstone from "../lib/accountDeletionTombstone.js";
import type * as lib_audioOverviewLegacyBoundary from "../lib/audioOverviewLegacyBoundary.js";
import type * as lib_audioOverviewOrchestrationAuth from "../lib/audioOverviewOrchestrationAuth.js";
import type * as lib_audioOverviewPolicy from "../lib/audioOverviewPolicy.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_calendarTokenRuntime from "../lib/calendarTokenRuntime.js";
import type * as lib_dates from "../lib/dates.js";
import type * as lib_learnV2Access from "../lib/learnV2Access.js";
import type * as lib_masteryStateMachine from "../lib/masteryStateMachine.js";
import type * as lib_sm2 from "../lib/sm2.js";
import type * as lib_streak from "../lib/streak.js";
import type * as messages from "../messages.js";
import type * as migrations from "../migrations.js";
import type * as quizzes from "../quizzes.js";
import type * as rateLimits from "../rateLimits.js";
import type * as reviewItems from "../reviewItems.js";
import type * as sourceExtractors from "../sourceExtractors.js";
import type * as tasks from "../tasks.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accountDeletion: typeof accountDeletion;
  archiveMultiChat: typeof archiveMultiChat;
  audioOverviewInterjections: typeof audioOverviewInterjections;
  audioOverviewInterjectionsV2: typeof audioOverviewInterjectionsV2;
  audioOverviewJobUploadActions: typeof audioOverviewJobUploadActions;
  audioOverviewJobs: typeof audioOverviewJobs;
  audioOverviewRooms: typeof audioOverviewRooms;
  audioOverviewUploadActions: typeof audioOverviewUploadActions;
  audioOverviewUploads: typeof audioOverviewUploads;
  audioOverviewV2: typeof audioOverviewV2;
  audioOverviews: typeof audioOverviews;
  auth: typeof auth;
  calendarConnections: typeof calendarConnections;
  calendarEventCleanup: typeof calendarEventCleanup;
  calendarEvents: typeof calendarEvents;
  contentFlags: typeof contentFlags;
  conversations: typeof conversations;
  courseDeletion: typeof courseDeletion;
  courseSections: typeof courseSections;
  courseSourceDocs: typeof courseSourceDocs;
  courses: typeof courses;
  crons: typeof crons;
  dataExport: typeof dataExport;
  documentActions: typeof documentActions;
  documentImports: typeof documentImports;
  documents: typeof documents;
  flashcardRooms: typeof flashcardRooms;
  folderIcons: typeof folderIcons;
  folderPalette: typeof folderPalette;
  folders: typeof folders;
  http: typeof http;
  learnProfile: typeof learnProfile;
  learnV2Access: typeof learnV2Access;
  learnV2FolderManifests: typeof learnV2FolderManifests;
  learnV2Lifecycle: typeof learnV2Lifecycle;
  learnV2Retention: typeof learnV2Retention;
  "lib/accountDeletionTombstone": typeof lib_accountDeletionTombstone;
  "lib/audioOverviewLegacyBoundary": typeof lib_audioOverviewLegacyBoundary;
  "lib/audioOverviewOrchestrationAuth": typeof lib_audioOverviewOrchestrationAuth;
  "lib/audioOverviewPolicy": typeof lib_audioOverviewPolicy;
  "lib/auth": typeof lib_auth;
  "lib/calendarTokenRuntime": typeof lib_calendarTokenRuntime;
  "lib/dates": typeof lib_dates;
  "lib/learnV2Access": typeof lib_learnV2Access;
  "lib/masteryStateMachine": typeof lib_masteryStateMachine;
  "lib/sm2": typeof lib_sm2;
  "lib/streak": typeof lib_streak;
  messages: typeof messages;
  migrations: typeof migrations;
  quizzes: typeof quizzes;
  rateLimits: typeof rateLimits;
  reviewItems: typeof reviewItems;
  sourceExtractors: typeof sourceExtractors;
  tasks: typeof tasks;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
