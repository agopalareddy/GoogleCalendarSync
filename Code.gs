/**
 * @fileoverview Google Apps Script to sync events from multiple source calendars
 * to a single destination calendar for sharing availability without revealing
 * private event details.
 * @version 1.2
 */

// --- CONFIGURATION ---
/**
 * An array of Calendar IDs for the source calendars you want to sync from.
 * @type {string[]}
 */
const SOURCE_CALENDAR_IDS = [
  'primary.email@example.com',
  'calendar_id_2@group.calendar.google.com',
  'calendar_id_3@group.calendar.google.com'
];

/**
 * The Calendar ID for the destination calendar where generic "Busy"
 * events will be created.
 * @type {string}
 */
const DESTINATION_CALENDAR_ID = 'destination_calendar_id@group.calendar.google.com';

/**
 * The title for the events created on the destination calendar.
 * @type {string}
 */
const EVENT_TITLE = 'Busy';

/**
 * The earliest date the script should look for events to sync.
 * Format: YYYY-MM-DD
 * @type {string}
 */
const SYNC_START_DATE = '2025-01-01'; // replace with new Date() to use today's date

/**
 * A unique tag added to the description of script-generated events. This
 * prevents the script from deleting manually created events on the destination calendar.
 * @type {string}
 * @const
 */
const SYNC_TAG = 'sync-id:auto-generated';

/**
 * The time in milliseconds to wait between creating/deleting events to avoid
 * hitting Google's API rate limits. 1500ms = 1.5 seconds.
 * @type {number}
 * @const
 */
const WAIT_TIME = 1500;


// --- SCRIPT LOGIC (No need to edit below this line) ---

/**
 * Main function for frequent triggers (e.g., every hour).
 * Processes one recent batch of events to keep the calendar up-to-date.
 * Uses PropertiesService to maintain a cursor of its progress.
 */
function processSyncBatch() {
  const properties = PropertiesService.getScriptProperties();
  const destinationCalendar = CalendarApp.getCalendarById(DESTINATION_CALENDAR_ID);

  let cursor = properties.getProperty('syncCursor');
  if (!cursor) {
    cursor = SYNC_START_DATE;
  }

  let startTime = new Date(cursor);
  let endTime = new Date(startTime);
  endTime.setDate(endTime.getDate() + 31); // Process a ~1 month chunk

  const now = new Date();
  if (endTime > now) {
    endTime = now;
  }

  Logger.log(`Processing batch from ${startTime.toLocaleDateString()} to ${endTime.toLocaleDateString()}`);

  deleteOrphanedEventsInBatch(destinationCalendar, startTime, endTime);
  createMissingEventsInBatch(destinationCalendar, startTime, endTime);

  properties.setProperty('syncCursor', endTime.toISOString());
  Logger.log(`Sync batch complete. Next run will start from: ${endTime.toLocaleDateString()}`);
}

/**
 * Nightly function to do a full, comprehensive sync from the very beginning.
 * This acts as a safeguard to catch anything the batch processor might have missed.
 */
function runFullSync() {
  Logger.log('--- Starting Nightly Full Sync ---');
  const destinationCalendar = CalendarApp.getCalendarById(DESTINATION_CALENDAR_ID);
  if (!destinationCalendar) {
    Logger.log('Full Sync Aborted: Destination calendar not found.');
    return;
  }

  let loopStartTime = new Date(SYNC_START_DATE);
  const today = new Date();

  while (loopStartTime < today) {
    let loopEndTime = new Date(loopStartTime);
    loopEndTime.setDate(loopEndTime.getDate() + 31);

    if (loopEndTime > today) {
      loopEndTime = today;
    }

    Logger.log(`Full Sync | Processing batch from ${loopStartTime.toLocaleDateString()} to ${loopEndTime.toLocaleDateString()}`);
    deleteOrphanedEventsInBatch(destinationCalendar, loopStartTime, loopEndTime);
    createMissingEventsInBatch(destinationCalendar, loopStartTime, loopEndTime);
    loopStartTime = loopEndTime;
  }

  Logger.log('--- Nightly Full Sync Complete ---');
}

/**
 * Creates missing events in the destination calendar for a given time window.
 * @param {GoogleAppsScript.Calendar.Calendar} destinationCalendar The destination calendar object.
 * @param {Date} startTime The start of the time window to process.
 * @param {Date} endTime The end of the time window to process.
 */
function createMissingEventsInBatch(destinationCalendar, startTime, endTime) {
  SOURCE_CALENDAR_IDS.forEach(sourceId => {
    const sourceCalendar = CalendarApp.getCalendarById(sourceId);
    if (sourceCalendar) {
      const sourceEvents = sourceCalendar.getEvents(startTime, endTime);
      sourceEvents.forEach(event => {
        if (!event.isAllDayEvent()) {
          const existingEvents = destinationCalendar.getEvents(event.getStartTime(), event.getEndTime(), {
            search: EVENT_TITLE
          });
          if (existingEvents.length === 0) {
            Logger.log(`CREATING event from ${sourceCalendar.getName()}`);
            destinationCalendar.createEvent(EVENT_TITLE, event.getStartTime(), event.getEndTime(), {
              description: SYNC_TAG
            });
            Utilities.sleep(WAIT_TIME);
          }
        }
      });
    }
  });
}

/**
 * Deletes orphaned, script-generated events from the destination calendar for a given time window.
 * @param {GoogleAppsScript.Calendar.Calendar} destinationCalendar The destination calendar object.
 * @param {Date} startTime The start of the time window to process.
 * @param {Date} endTime The end of the time window to process.
 */
function deleteOrphanedEventsInBatch(destinationCalendar, startTime, endTime) {
  const busyEvents = destinationCalendar.getEvents(startTime, endTime, {
    search: EVENT_TITLE
  });

  busyEvents.forEach(busyEvent => {
    // Only process events that have our script's tag.
    if (busyEvent.getDescription().includes(SYNC_TAG)) {
      let hasSourceEvent = false;
      const busyStartTime = busyEvent.getStartTime();
      const busyEndTime = busyEvent.getEndTime();

      for (const sourceId of SOURCE_CALENDAR_IDS) {
        const sourceCalendar = CalendarApp.getCalendarById(sourceId);
        if (sourceCalendar) {
          const potentialEvents = sourceCalendar.getEvents(busyStartTime, busyEndTime);
          // Check if a non-all-day event exists in the source with the exact same time.
          if (potentialEvents.some(e => e.getStartTime().getTime() === busyStartTime.getTime() && e.getEndTime().getTime() === busyEndTime.getTime() && !e.isAllDayEvent())) {
            hasSourceEvent = true;
            break; // Found a parent, no need to check other calendars.
          }
        }
      }

      if (!hasSourceEvent) {
        Logger.log(`DELETING orphaned event at ${busyStartTime}`);
        busyEvent.deleteEvent();
        Utilities.sleep(WAIT_TIME);
      }
    }
  });
}

/**
 * Utility function to reset the sync process.
 * Run this manually from the script editor to start the historical sync over from the beginning.
 */
function resetSync() {
  PropertiesService.getScriptProperties().deleteProperty('syncCursor');
  Logger.log('Sync cursor has been reset. The next run will start from the beginning.');
}
