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
 * The IANA timezone name for the nightly reset check and date boundary calculations.
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

  // 1. Get all relevant events from all source calendars and map them to daily segments.
  let allSourceSegments = [];
  SOURCE_CALENDAR_IDS.forEach((id) => {
    const sourceCal = CalendarApp.getCalendarById(id);
    if (sourceCal) {
      try {
        const events = sourceCal.getEvents(startTime, endTime);
        events.forEach((e) => {
          // --- Smart Filtering ---
          // Filter out explicitly declined invitations
          try {
            if (e.getMyStatus() === CalendarApp.GuestStatus.NO) {
              return;
            }
          } catch (err) {
            // Ignore errors if getMyStatus() is not supported (e.g., read-only public import calendars)
          }

          // Filter out events marked as "Free" (Transparent), such as holidays, birthdays, or manually set free times
          try {
            if (e.getTransparency() === CalendarApp.EventTransparency.TRANSPARENT) {
              return;
            }
          } catch (err) {
            // Ignore if getTransparency() is not supported
          }

          const isAllDay = e.isAllDayEvent();
          const startStr = Utilities.formatDate(e.getStartTime(), TIMEZONE, "yyyy-MM-dd");
          const endStr = Utilities.formatDate(e.getEndTime(), TIMEZONE, "yyyy-MM-dd");

          // Convert all-day or multi-day events into single-day timed segments
          // to ensure they display on the calendar grid rather than the top banner.
          if (isAllDay) {
            let current = Utilities.parseDate(startStr, TIMEZONE, "yyyy-MM-dd");
            const end = Utilities.parseDate(endStr, TIMEZONE, "yyyy-MM-dd");
            while (current < end) {
              const dayStr = Utilities.formatDate(current, TIMEZONE, "yyyy-MM-dd");
              allSourceSegments.push({
                isAllDay: true,
                dateStamp: dayStr,
                startTime: Utilities.parseDate(dayStr + " 00:00:00", TIMEZONE, "yyyy-MM-dd HH:mm:ss"),
                endTime: Utilities.parseDate(dayStr + " 23:59:59", TIMEZONE, "yyyy-MM-dd HH:mm:ss"),
                sourceCalendarId: id,
              });
              current.setDate(current.getDate() + 1);
            }
          } else {
            // Timed event
            if (startStr === endStr) {
              // Single-day timed event
              allSourceSegments.push({
                isAllDay: false,
                startTime: e.getStartTime(),
                endTime: e.getEndTime(),
                sourceCalendarId: id,
              });
            } else {
              // Multi-day timed event: split into daily segments
              let current = Utilities.parseDate(startStr, TIMEZONE, "yyyy-MM-dd");
              const end = Utilities.parseDate(endStr, TIMEZONE, "yyyy-MM-dd");
              while (current <= end) {
                const dayStr = Utilities.formatDate(current, TIMEZONE, "yyyy-MM-dd");
                let segStart =
                  dayStr === startStr
                    ? e.getStartTime()
                    : Utilities.parseDate(dayStr + " 00:00:00", TIMEZONE, "yyyy-MM-dd HH:mm:ss");
                let segEnd =
                  dayStr === endStr
                    ? e.getEndTime()
                    : Utilities.parseDate(dayStr + " 23:59:59", TIMEZONE, "yyyy-MM-dd HH:mm:ss");

                if (segStart < segEnd) {
                  allSourceSegments.push({
                    isAllDay: false,
                    startTime: segStart,
                    endTime: segEnd,
                    sourceCalendarId: id,
                  });
                }
                current.setDate(current.getDate() + 1);
              }
            }
          }
        });
      } catch (err) {
        Logger.log(
          `Could not access calendar ${id}. It may be a permissions issue or the calendar was removed.`
        );
      }
    }
  });

  // 2. Get all script-generated events from the destination calendar.
  let destinationEvents = destinationCalendar
    .getEvents(startTime, endTime)
    .filter((e) => e.getDescription().includes(SYNC_TAG));

  // Parse destination events to easily identify all-day vs. timed entries.
  let parsedDestEvents = destinationEvents.map((destEvent) => {
    const desc = destEvent.getDescription();
    const isAllDay = desc.includes("all-day:");
    let dateStamp = null;
    if (isAllDay) {
      const match = desc.match(/all-day:(\d{4}-\d{2}-\d{2})/);
      if (match) {
        dateStamp = match[1];
      }
    }
    return {
      event: destEvent,
      isAllDay: isAllDay,
      dateStamp: dateStamp,
      startTimeMs: destEvent.getStartTime().getTime(),
      endTimeMs: destEvent.getEndTime().getTime(),
    };
  });

  // 3. Reconcile: Find segments to CREATE or UPDATE.
  allSourceSegments.forEach((sourceSeg) => {
    const expectedTitle = CALENDAR_NAMES[sourceSeg.sourceCalendarId] || EVENT_TITLE;
    let matchingDestIndex = -1;

    if (sourceSeg.isAllDay) {
      // All-Day reconciliation: Match securely using explicit standard date stamps (YYYY-MM-DD)
      matchingDestIndex = parsedDestEvents.findIndex(
        (dest) => dest.isAllDay && dest.dateStamp === sourceSeg.dateStamp
      );
    } else {
      // Timed reconciliation: Match via precise millisecond epoch values
      matchingDestIndex = parsedDestEvents.findIndex(
        (dest) =>
          !dest.isAllDay &&
          dest.startTimeMs === sourceSeg.startTime.getTime() &&
          dest.endTimeMs === sourceSeg.endTime.getTime()
      );
    }

    if (matchingDestIndex !== -1) {
      // A matching event exists. Check if title needs updating, then mark as correctly synced.
      const matched = parsedDestEvents[matchingDestIndex];
      if (matched.event.getTitle() !== expectedTitle) {
        Logger.log(
          `UPDATING event title from "${matched.event.getTitle()}" to "${expectedTitle}"`
        );
        matched.event.setTitle(expectedTitle);
        Utilities.sleep(WAIT_TIME);
      }
      // Remove from active list (not an orphan)
      parsedDestEvents.splice(matchingDestIndex, 1);
    } else {
      // No matching event found. Create it.
      if (sourceSeg.isAllDay) {
        const description = `${SYNC_TAG} | all-day:${sourceSeg.dateStamp}`;
        Logger.log(
          `CREATING all-day slot on ${sourceSeg.dateStamp} with title: ${expectedTitle}`
        );
        destinationCalendar.createEvent(expectedTitle, sourceSeg.startTime, sourceSeg.endTime, {
          description: description,
        });
      } else {
        const description = SYNC_TAG;
        Logger.log(
          `CREATING timed slot at ${sourceSeg.startTime} to ${sourceSeg.endTime} with title: ${expectedTitle}`
        );
        destinationCalendar.createEvent(expectedTitle, sourceSeg.startTime, sourceSeg.endTime, {
          description: description,
        });
      }
      Utilities.sleep(WAIT_TIME);
    }
  });

  // 4. Reconcile: Find events to DELETE.
  // Any events left in parsedDestEvents are orphans (their source was deleted, declined, or changed).
  parsedDestEvents.forEach((orphan) => {
    Logger.log(`DELETING orphaned event at ${orphan.event.getStartTime()}`);
    orphan.event.deleteEvent();
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
