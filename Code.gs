/**
 * @fileoverview Google Apps Script to sync events from multiple source calendars
 * to a single destination calendar using a robust reconciliation model.
 * @version 3.0
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
const DESTINATION_CALENDAR_ID = "destination_calendar_id@group.calendar.google.com";

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
 * The earliest date the script should look for events during manual full sync runs.
 * Format: YYYY-MM-DD
 * @type {string}
 */
const SYNC_START_DATE = "2025-01-01";

/**
 * A unique tag added to the description of script-generated events. This
 * prevents the script from deleting manually created events on the destination calendar.
 * @type {string}
 * @const
 */
const SYNC_TAG = "sync-id:auto-generated";

/**
 * The IANA timezone name for date boundary calculations.
 * Leave blank to dynamically detect your primary calendar's timezone.
 * @type {string}
 */
const TIMEZONE = "America/Chicago";

/**
 * Number of days in the past to sync on every rolling execution.
 * Keep this small (e.g. 7 days) to catch recent modifications/deletions.
 * @type {number}
 */
const SYNC_DAYS_BEFORE = 7;

/**
 * Number of days in the future to sync on every rolling execution.
 * Keep this at a standard range (e.g. 30 days) to prevent rate limits while maintaining forward visibility.
 * @type {number}
 */
const SYNC_DAYS_AFTER = 30;


// --- PRIMARY TRIGGER FUNCTIONS ---

/**
 * Main function for frequent triggers (e.g., every 5 minutes).
 * Performs a rolling sliding-window sync around the current date.
 * Does not require script properties or cursor resets.
 */
function processSyncBatch() {
  const activeTimezone = TIMEZONE || CalendarApp.getDefaultCalendar().getTimeZone() || Session.getScriptTimeZone();
  const today = new Date();
  
  // Calculate rolling start time (start of day, SYNC_DAYS_BEFORE days ago)
  const startTime = new Date(today.getTime());
  startTime.setDate(startTime.getDate() - SYNC_DAYS_BEFORE);
  startTime.setHours(0, 0, 0, 0);
  
  // Calculate rolling end time (end of day, SYNC_DAYS_AFTER days from now)
  const endTime = new Date(today.getTime());
  endTime.setDate(endTime.getDate() + SYNC_DAYS_AFTER);
  endTime.setHours(23, 59, 59, 999);

  Logger.log(`[Rolling Sync] Processing window from ${Utilities.formatDate(startTime, activeTimezone, "yyyy-MM-dd HH:mm:ss")} to ${Utilities.formatDate(endTime, activeTimezone, "yyyy-MM-dd HH:mm:ss")} (${activeTimezone})`);
  reconcileBatch(startTime, endTime);
  Logger.log('[Rolling Sync] Complete.');
}

/**
 * Standalone function for a full, comprehensive sync over a long period.
 * Intended for manual execution or a periodic (e.g., weekly) trigger.
 */
function runFullSync() {
  const activeTimezone = TIMEZONE || CalendarApp.getDefaultCalendar().getTimeZone() || Session.getScriptTimeZone();
  Logger.log('--- Starting Full Manual Sync ---');
  
  const startTime = new Date(SYNC_START_DATE);
  const today = new Date();
  const endTime = new Date(today.getTime());
  endTime.setDate(endTime.getDate() + SYNC_DAYS_AFTER);
  endTime.setHours(23, 59, 59, 999);

  Logger.log(`[Full Sync] Reconciling entire history from ${Utilities.formatDate(startTime, activeTimezone, "yyyy-MM-dd")} to ${Utilities.formatDate(endTime, activeTimezone, "yyyy-MM-dd")}`);
  reconcileBatch(startTime, endTime);
  
  Logger.log('--- Full Manual Sync Complete ---');
}


// --- CORE LOGIC ---

/**
 * Reconciles events between source and destination calendars for a given time window.
 * Integrates interval overlap consolidation, timezone awareness, and dynamic backoff retries.
 * @param {Date} startTime The start of the time window to process.
 * @param {Date} endTime The end of the time window to process.
 */
function reconcileBatch(startTime, endTime) {
  const activeTimezone = TIMEZONE || CalendarApp.getDefaultCalendar().getTimeZone() || Session.getScriptTimeZone();
  const destinationCalendar = CalendarApp.getCalendarById(DESTINATION_CALENDAR_ID);
  
  if (!destinationCalendar) {
    Logger.log('Reconciliation Aborted: Destination calendar not found.');
    return;
  }

  // 1. Fetch, filter, and normalize all source events
  let timedSegments = [];
  let allDaySegments = [];

  SOURCE_CALENDAR_IDS.forEach(id => {
    const sourceCal = CalendarApp.getCalendarById(id);
    if (!sourceCal) {
      Logger.log(`Could not access calendar ${id}. It may be a permissions issue or the calendar was removed.`);
      return;
    }

    try {
      const events = sourceCal.getEvents(startTime, endTime);
      events.forEach(e => {
        // --- Smart Filtering ---
        // Filter out explicitly declined invitations
        try {
          if (e.getMyStatus() === CalendarApp.GuestStatus.NO) {
            return;
          }
        } catch (err) {}

        // Filter out events marked as "Free" (Transparent)
        try {
          if (e.getTransparency() === CalendarApp.EventTransparency.TRANSPARENT) {
            return;
          }
        } catch (err) {}

        const isAllDay = e.isAllDayEvent();
        const startStr = Utilities.formatDate(e.getStartTime(), activeTimezone, "yyyy-MM-dd");
        const endStr = Utilities.formatDate(e.getEndTime(), activeTimezone, "yyyy-MM-dd");

        if (isAllDay) {
          // All-Day Event: Split into daily dateStamp entries
          let current = new Date(e.getStartTime().getTime());
          const end = e.getEndTime();
          while (current < end) {
            const dayStr = Utilities.formatDate(current, activeTimezone, "yyyy-MM-dd");
            allDaySegments.push({
              isAllDay: true,
              dateStamp: dayStr,
              sourceCalendarId: id
            });
            current.setDate(current.getDate() + 1);
          }
        } else {
          // Timed Event
          if (startStr === endStr) {
            // Single-day timed event
            timedSegments.push({
              isAllDay: false,
              startTime: e.getStartTime(),
              endTime: e.getEndTime(),
              sourceCalendarId: id
            });
          } else {
            // Multi-day timed event: split into daily timed segments
            let current = new Date(e.getStartTime().getTime());
            const end = e.getEndTime();
            while (current <= end) {
              const dayStr = Utilities.formatDate(current, activeTimezone, "yyyy-MM-dd");
              
              let segStart = (dayStr === startStr) 
                ? e.getStartTime() 
                : Utilities.parseDate(dayStr + " 00:00:00", activeTimezone, "yyyy-MM-dd HH:mm:ss");
                
              let segEnd = (dayStr === endStr) 
                ? e.getEndTime() 
                : Utilities.parseDate(dayStr + " 23:59:59", activeTimezone, "yyyy-MM-dd HH:mm:ss");
              
              if (segStart.getTime() < segEnd.getTime()) {
                timedSegments.push({
                  isAllDay: false,
                  startTime: segStart,
                  endTime: segEnd,
                  sourceCalendarId: id
                });
              }
              current.setDate(current.getDate() + 1);
              current.setHours(0, 0, 0, 0);
            }
          }
        }
      });
    } catch (err) {
      Logger.log(`Error reading events from calendar ${id}: ${err.toString()}`);
    }
  });

  // 2. Interval-based Overlap Consolidation

  // A. Consolidate Timed segments
  let mergedTimed = [];
  if (timedSegments.length > 0) {
    // Sort chronologically by start time
    timedSegments.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

    let current = {
      startTime: timedSegments[0].startTime,
      endTime: timedSegments[0].endTime,
      sourceCalendarIds: [timedSegments[0].sourceCalendarId]
    };

    for (let i = 1; i < timedSegments.length; i++) {
      let seg = timedSegments[i];
      // If overlapping or adjacent (seg starts before or exactly at current end time)
      if (seg.startTime.getTime() <= current.endTime.getTime()) {
        // Extend end time if next event ends later
        if (seg.endTime.getTime() > current.endTime.getTime()) {
          current.endTime = seg.endTime;
        }
        if (!current.sourceCalendarIds.includes(seg.sourceCalendarId)) {
          current.sourceCalendarIds.push(seg.sourceCalendarId);
        }
      } else {
        mergedTimed.push(current);
        current = {
          startTime: seg.startTime,
          endTime: seg.endTime,
          sourceCalendarIds: [seg.sourceCalendarId]
        };
      }
    }
    mergedTimed.push(current);
  }

  // B. Consolidate All-Day segments by dateStamp
  let allDayGroups = {};
  allDaySegments.forEach(seg => {
    if (!allDayGroups[seg.dateStamp]) {
      allDayGroups[seg.dateStamp] = [];
    }
    if (!allDayGroups[seg.dateStamp].includes(seg.sourceCalendarId)) {
      allDayGroups[seg.dateStamp].push(seg.sourceCalendarId);
    }
  });

  let mergedAllDay = Object.keys(allDayGroups).map(dateStr => {
    let dayStart = Utilities.parseDate(dateStr + " 00:00:00", activeTimezone, "yyyy-MM-dd HH:mm:ss");
    let dayEnd = Utilities.parseDate(dateStr + " 23:59:59", activeTimezone, "yyyy-MM-dd HH:mm:ss");
    return {
      dateStamp: dateStr,
      startTime: dayStart,
      endTime: dayEnd,
      sourceCalendarIds: allDayGroups[dateStr]
    };
  });

  // 3. Get and parse existing script-generated events on the destination calendar
  const destinationEvents = destinationCalendar.getEvents(startTime, endTime)
    .filter(e => e.getDescription().includes(SYNC_TAG));

  let parsedDestEvents = destinationEvents.map(destEvent => {
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
      endTimeMs: destEvent.getEndTime().getTime()
    };
  });

  // Helper to resolve combined titles and descriptions
  const getExpectedMeta = (sourceCalendarIds, isAllDay, dateStamp = null) => {
    // Resolve custom names, fallback to default EVENT_TITLE
    let names = sourceCalendarIds.map(id => CALENDAR_NAMES[id] || EVENT_TITLE);
    // Deduplicate and sort
    let uniqueNames = [...new Set(names)].sort();
    
    let expectedTitle = uniqueNames.join(' & ') || EVENT_TITLE;
    let expectedDescription = isAllDay 
      ? `${SYNC_TAG} | all-day:${dateStamp} | Sources: ${uniqueNames.join(', ')}`
      : `${SYNC_TAG} | Sources: ${uniqueNames.join(', ')}`;
      
    return { expectedTitle, expectedDescription };
  };

  // 4. Reconcile: CREATE or UPDATE

  // Reconcile All-Day consolidated blocks
  mergedAllDay.forEach(segment => {
    const { expectedTitle, expectedDescription } = getExpectedMeta(segment.sourceCalendarIds, true, segment.dateStamp);
    
    const matchingDestIndex = parsedDestEvents.findIndex(dest => 
      dest.isAllDay && dest.dateStamp === segment.dateStamp
    );

    if (matchingDestIndex !== -1) {
      const matched = parsedDestEvents[matchingDestIndex];
      // Update title or description if changed
      if (matched.event.getTitle() !== expectedTitle || matched.event.getDescription() !== expectedDescription) {
        Logger.log(`[All-Day Update] Updating event on ${segment.dateStamp} -> Title: "${expectedTitle}", Desc: "${expectedDescription}"`);
        callWithBackoff(() => {
          matched.event.setTitle(expectedTitle);
          matched.event.setDescription(expectedDescription);
        });
      }
      parsedDestEvents.splice(matchingDestIndex, 1); // remove from orphaned list
    } else {
      // Create new consolidated all-day slot
      Logger.log(`[All-Day Create] Creating slot on ${segment.dateStamp} -> Title: "${expectedTitle}"`);
      callWithBackoff(() => {
        destinationCalendar.createEvent(expectedTitle, segment.startTime, segment.endTime, {
          description: expectedDescription
        });
      });
    }
  });

  // Reconcile Timed consolidated blocks
  mergedTimed.forEach(segment => {
    const { expectedTitle, expectedDescription } = getExpectedMeta(segment.sourceCalendarIds, false);

    const matchingDestIndex = parsedDestEvents.findIndex(dest => 
      !dest.isAllDay &&
      dest.startTimeMs === segment.startTime.getTime() &&
      dest.endTimeMs === segment.endTime.getTime()
    );

    if (matchingDestIndex !== -1) {
      const matched = parsedDestEvents[matchingDestIndex];
      // Update title or description if changed
      if (matched.event.getTitle() !== expectedTitle || matched.event.getDescription() !== expectedDescription) {
        Logger.log(`[Timed Update] Updating event at ${segment.startTime} -> Title: "${expectedTitle}", Desc: "${expectedDescription}"`);
        callWithBackoff(() => {
          matched.event.setTitle(expectedTitle);
          matched.event.setDescription(expectedDescription);
        });
      }
      parsedDestEvents.splice(matchingDestIndex, 1); // remove from orphaned list
    } else {
      // Create new consolidated timed slot
      Logger.log(`[Timed Create] Creating slot at ${segment.startTime} to ${segment.endTime} -> Title: "${expectedTitle}"`);
      callWithBackoff(() => {
        destinationCalendar.createEvent(expectedTitle, segment.startTime, segment.endTime, {
          description: expectedDescription
        });
      });
    }
  });

  // 5. Reconcile: DELETE Orphans
  parsedDestEvents.forEach(orphan => {
    Logger.log(`[Delete Orphan] Deleting outdated/cancelled event at ${orphan.event.getStartTime()}`);
    callWithBackoff(() => {
      orphan.event.deleteEvent();
    });
  });
}


// --- UTILITY FUNCTIONS ---

/**
 * Wraps a Google Calendar API operation with exponential backoff to handle rate limits gracefully.
 * @param {Function} operation The function containing the Calendar API call.
 * @param {number} maxRetries The maximum number of retries (default: 4).
 * @return {*} The result of the operation.
 */
function callWithBackoff(operation, maxRetries = 4) {
  let attempt = 0;
  while (true) {
    try {
      return operation();
    } catch (e) {
      attempt++;
      const errorMessage = e.message || e.toString();
      const msg = errorMessage.toLowerCase();
      
      // Google Calendar specific write quota and rate limit patterns
      const isRateLimit = msg.includes('rate limit') || 
                          msg.includes('quota') || 
                          msg.includes('too many') || 
                          msg.includes('short time') || 
                          msg.includes('try again') || 
                          msg.includes('limit');
      
      if (isRateLimit && attempt <= maxRetries) {
        // Sleep dynamically: 2^attempt * 1000ms + random jitter of up to 1000ms
        const sleepTime = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
        Logger.log(`Rate limit or API quota warning encountered. Sleeping for ${Math.round(sleepTime)}ms before retry (${attempt}/${maxRetries})...`);
        Utilities.sleep(sleepTime);
      } else {
        Logger.log(`Operation failed definitively: ${errorMessage}`);
        throw e;
      }
    }
  }
}

/**
 * Utility function to manually reset the legacy cursor properties if needed.
 * This is no longer required for rolling sync, but clears properties to keep properties tidy.
 */
function resetSync() {
  PropertiesService.getScriptProperties().deleteProperty('syncCursor');
  PropertiesService.getScriptProperties().deleteProperty('lastResetDate');
  Logger.log('Legacy sync properties cleared successfully.');
}
