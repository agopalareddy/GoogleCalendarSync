/**
 * @fileoverview Google Apps Script to sync events from multiple source calendars
 * to a single destination calendar using a robust reconciliation model.
 * @version 2.0
 */

// --- CONFIGURATION ---
/**
 * An array of Calendar IDs for the source calendars you want to sync from.
 * @type {string[]}
 */
const SOURCE_CALENDAR_IDS = [
  "your_primary_email@example.com",
  "source_calendar_1@group.calendar.google.com",
  "source_calendar_2@group.calendar.google.com",
  "source_calendar_3@group.calendar.google.com",
  "source_calendar_4@import.calendar.google.com",
];

/**
 * The Calendar ID for the destination calendar where generic "Busy"
 * events will be created.
 * @type {string}
 */
const DESTINATION_CALENDAR_ID =
  "destination_calendar_id@group.calendar.google.com";

/**
 * The title for the events created on the destination calendar.
 * @type {string}
 */
const EVENT_TITLE = "Busy";

/**
 * A mapping of source calendar IDs to custom event titles on the destination calendar.
 * Keys should match entries in SOURCE_CALENDAR_IDS. If a calendar ID is not found here,
 * the script will fall back to the EVENT_TITLE constant.
 * @type {Object<string, string>}
 */
const CALENDAR_NAMES = {
  "your_primary_email@example.com": "Personal",
  "source_calendar_1@group.calendar.google.com": "Work",
  "source_calendar_2@group.calendar.google.com": "Busy",
  "source_calendar_3@group.calendar.google.com": "Class",
  "source_calendar_4@import.calendar.google.com": "Busy",
};

/**
 * The earliest date the script should look for events during the very first sync.
 * Format: YYYY-MM-DD
 * @type {string}
 */
const SYNC_START_DATE = "2025-01-01";

/**
 * The IANA timezone name for the nightly reset check (e.g., "America/New_York", "Europe/London").
 * This ensures the reset happens at the correct local time.
 * @type {string}
 */
const TIMEZONE = "America/Chicago";

/**
 * A unique tag added to the description of script-generated events. This
 * prevents the script from deleting manually created events on the destination calendar.
 * @type {string}
 * @const
 */
const SYNC_TAG = "sync-id:auto-generated";

/**
 * The time in milliseconds to wait between creating/deleting events to avoid
 * hitting Google's API rate limits. 1000ms = 1 second.
 * @type {number}
 * @const
 */
const WAIT_TIME = 1000;

// --- PRIMARY TRIGGER FUNCTIONS ---

/**
 * Main function for frequent triggers (e.g., every 15 minutes).
 * Processes a single batch of events. It includes logic to reset its sync
 * cursor to the SYNC_START_DATE every night at 5 AM Central Time.
 */
function processSyncBatch() {
  const properties = PropertiesService.getScriptProperties();

  // --- Nightly Cursor Reset Logic ---
  const now = new Date();
  const todayCt = Utilities.formatDate(now, TIMEZONE, "yyyy-MM-dd");
  const hourCt = parseInt(Utilities.formatDate(now, TIMEZONE, "H"), 10);
  const lastResetDate = properties.getProperty("lastResetDate");

  if (hourCt === 5 && todayCt !== lastResetDate) {
    Logger.log("Performing nightly cursor reset for 5 AM CT.");
    properties.setProperty("syncCursor", SYNC_START_DATE);
    properties.setProperty("lastResetDate", todayCt); // Mark that we've reset for today.
  }
  // --- End Reset Logic ---

  let cursor = properties.getProperty("syncCursor");
  if (!cursor) {
    cursor = SYNC_START_DATE;
  }

  let startTime = new Date(cursor);

  // --- Future Cursor Check ---
  const today = new Date();
  const oneYearFromToday = new Date();
  oneYearFromToday.setFullYear(oneYearFromToday.getFullYear() + 1);

  if (startTime > oneYearFromToday) {
    Logger.log(
      "Sync cursor is more than a year in the future. Resetting to today."
    );
    startTime = today;
    properties.setProperty("syncCursor", startTime.toISOString());
  }
  // --- End Future Cursor Check ---

  let endTime = new Date(startTime);
  endTime.setDate(endTime.getDate() + 31); // Process a ~1 month chunk

  Logger.log(
    `Processing batch from ${startTime.toLocaleDateString()} to ${endTime.toLocaleDateString()}`
  );
  reconcileBatch(startTime, endTime);

  // Update the cursor for the next run.
  properties.setProperty("syncCursor", endTime.toISOString());
  Logger.log(
    `Sync batch complete. Next run will start from: ${endTime.toLocaleDateString()}`
  );
}

/**
 * Standalone function for a full, comprehensive sync over a long period.
 * Intended for manual execution or a periodic (e.g., weekly) trigger.
 */
function runFullSync() {
  Logger.log("--- Starting Full Manual Sync ---");
  let loopStartTime = new Date(SYNC_START_DATE);
  const today = new Date();

  while (loopStartTime < today) {
    let loopEndTime = new Date(loopStartTime);
    loopEndTime.setDate(loopEndTime.getDate() + 31);

    if (loopEndTime > today) {
      loopEndTime = today;
    }

    Logger.log(
      `Full Sync | Processing batch from ${loopStartTime.toLocaleDateString()} to ${loopEndTime.toLocaleDateString()}`
    );
    reconcileBatch(loopStartTime, loopEndTime);
    loopStartTime = loopEndTime;
  }

  Logger.log("--- Full Manual Sync Complete ---");
}

// --- CORE LOGIC ---

/**
 * Reconciles events between source and destination calendars for a given time window.
 * This is the core engine that handles creation, deletion, and updates.
 * @param {Date} startTime The start of the time window to process.
 * @param {Date} endTime The end of the time window to process.
 */
function reconcileBatch(startTime, endTime) {
  const destinationCalendar = CalendarApp.getCalendarById(
    DESTINATION_CALENDAR_ID
  );
  if (!destinationCalendar) {
    Logger.log("Reconciliation Aborted: Destination calendar not found.");
    return;
  }

  // 1. Get all relevant events from all source calendars.
  let allSourceEvents = [];
  SOURCE_CALENDAR_IDS.forEach((id) => {
    const sourceCal = CalendarApp.getCalendarById(id);
    if (sourceCal) {
      try {
        const events = sourceCal.getEvents(startTime, endTime);
        const nonAllDayEvents = events
          .filter((e) => !e.isAllDayEvent())
          .map((event) => ({
            event: event,
            sourceCalendarId: id,
          }));
        allSourceEvents = allSourceEvents.concat(nonAllDayEvents);
      } catch (e) {
        Logger.log(
          `Could not access calendar ${id}. It may be a permissions issue or the calendar was removed.`
        );
      }
    }
  });

  // 2. Get all script-generated events from the destination calendar.
  // Search for all events with our sync tag, regardless of title, to handle multiple calendar titles.
  let destinationEvents = destinationCalendar
    .getEvents(startTime, endTime)
    .filter((e) => e.getDescription().includes(SYNC_TAG));

  // 3. Reconcile: Find events to CREATE.
  allSourceEvents.forEach((sourceEventData) => {
    const sourceEvent = sourceEventData.event;
    const sourceCalendarId = sourceEventData.sourceCalendarId;
    const sourceStartTimeMs = sourceEvent.getStartTime().getTime();
    const sourceEndTimeMs = sourceEvent.getEndTime().getTime();

    const matchingDestEventIndex = destinationEvents.findIndex(
      (destEvent) =>
        destEvent.getStartTime().getTime() === sourceStartTimeMs &&
        destEvent.getEndTime().getTime() === sourceEndTimeMs
    );

    if (matchingDestEventIndex !== -1) {
      // A matching event exists. Check if title needs updating, then mark as correctly synced.
      const destEvent = destinationEvents[matchingDestEventIndex];
      const expectedTitle = CALENDAR_NAMES[sourceCalendarId] || EVENT_TITLE;

      // Update title if it doesn't match the expected per-calendar title
      if (destEvent.getTitle() !== expectedTitle) {
        Logger.log(`UPDATING event title from "${destEvent.getTitle()}" to "${expectedTitle}"`);
        destEvent.setTitle(expectedTitle);
        Utilities.sleep(WAIT_TIME);
      }

      // Remove from orphans list (event is correctly synced)
      destinationEvents.splice(matchingDestEventIndex, 1);
    } else {
      // No matching event found. This is a new or updated event. Create it.
      const eventTitle = CALENDAR_NAMES[sourceCalendarId] || EVENT_TITLE;
      Logger.log(`CREATING event at ${sourceEvent.getStartTime()} with title: ${eventTitle}`);
      destinationCalendar.createEvent(
        eventTitle,
        sourceEvent.getStartTime(),
        sourceEvent.getEndTime(),
        {
          description: SYNC_TAG,
        }
      );
      Utilities.sleep(WAIT_TIME);
    }
  });

  // 4. Reconcile: Find events to DELETE.
  // Any events left in destinationEvents are orphans (their source was deleted or changed).
  destinationEvents.forEach((orphanEvent) => {
    Logger.log(`DELETING orphaned event at ${orphanEvent.getStartTime()}`);
    orphanEvent.deleteEvent();
    Utilities.sleep(WAIT_TIME);
  });
}

// --- UTILITY FUNCTIONS ---

/**
 * Utility function to manually reset the sync process for the main batch processor.
 * Run this from the script editor to force the next run of processSyncBatch
 * to start from the SYNC_START_DATE.
 */
function resetSync() {
  PropertiesService.getScriptProperties().deleteProperty("syncCursor");
  PropertiesService.getScriptProperties().deleteProperty("lastResetDate");
  Logger.log(
    "Sync cursor has been reset. The next run of processSyncBatch will start from the beginning."
  );
}
