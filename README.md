# **Google Calendar Availability Sync**

A Google Apps Script to automatically sync events from multiple source calendars to a single "Availability" calendar. This script creates customizable availability blocks (e.g., "Personal", "Work", "Class") based on the source calendar, allowing you to share your availability without revealing the private details of your appointments.

## **Features**

*   **One-Way Sync:** Copies events from multiple source calendars to one destination calendar.
*   **Privacy-Focused:** Creates customizable events, hiding original titles, descriptions, and guest lists while showing relevant availability context.
*   **Per-Calendar Event Naming:** Assigns custom event titles based on the source calendar (e.g., "Personal", "Work", "Class") instead of generic "Busy" titles.
*   **Smart Overlap Consolidation:** Automatically merges overlapping or adjacent events from multiple source calendars into a single, clean availability block. Custom-named source titles are combined (e.g., "Personal & Class") and active sources are detailed in the event description.
*   **Smart Title & Description Updates:** Instantly updates existing event titles and descriptions to match your per-calendar names and merged source details if they change.
*   **Smart Filtering:** Selectively handles all-day events while automatically filtering out event invitations you have explicitly declined (`GuestStatus.NO`) as well as events marked as "Free" (such as automatic holiday calendars, birthdays, or manual "free" times), ensuring only genuine commitments block your availability.
*   **Daily Segment Splitting:** Automatically splits all-day and multi-day timed events into individual daily timed segments. This forces Google Calendar (and third-party scheduling platforms) to display them as busy blocks inside the daily calendar grid rather than as all-day banner events across the top, keeping your hourly grid accurate.
*   **Unique Handling Matrix:** Reconciles timed events via precise millisecond epoch values and all-day events securely via standard date stamps (`YYYY-MM-DD`) saved inside the event description.
*   **Robust Reconciliation:** A powerful reconciliation model accurately creates and deletes events, preventing duplicate or orphaned entries. Automatically cleans up existing overlapping blocks on the first run.
*   **Automatic Deletion:** Automatically removes availability blocks when the original event is deleted or its time is changed.
*   **Manual Event Protection:** Allows you to manually add events to the destination calendar without the script deleting them.
*   **Rolling Sliding Window:** Reconciles a dynamic, configurable rolling window (e.g., past 7 days to future 30 days) on every trigger to catch changes immediately.
*   **Resilient Rate-Limit Protection:** Employs an exponential backoff retry mechanism to automatically handle Google's API rate limits, removing arbitrary execution pauses and accelerating performance to under 2 seconds.
*   **Dynamic Timezone Awareness:** Automatically detects and aligns with your primary calendar's timezone settings.

## **Setup Instructions**

Follow these steps to get the script running in your own Google account.

### **Step 1: Create Your Calendars**

1.  Ensure you have your primary calendars ready (e.g., Personal, Work, School).
2.  In Google Calendar, create a **new, separate calendar**. Name it something clear like "My Availability" or "Public Schedule". This will be your destination calendar.

### **Step 2: Get Your Calendar IDs**

You will need the unique ID for each of your source calendars and your new destination calendar.

1.  In Google Calendar, find a calendar in the list on the left.
2.  Click the three-dots menu (⋮) next to it and select **Settings and sharing**.
3.  Scroll down to the **Integrate calendar** section.
4.  Copy the **Calendar ID** (it often looks like an email address).
5.  Repeat this for all your source calendars and the destination calendar.

### **Step 3: Create the Google Apps Script Project**

1.  Go to [script.google.com](https://script.google.com).
2.  Click **New project** in the top-left.
3.  Give the project a name, like "Calendar Sync Service".

### **Step 4: Add the Code**

1.  Delete any placeholder code in the editor.
2.  Copy the entire contents of the `Code.gs` file from this repository and paste it into the script editor.
3.  Click the **Save project** icon.

### **Step 5: Configure the Script**

In the `Code.gs` file, find the `CONFIGURATION` section at the top and replace the placeholder values with your own.

*   `SOURCE_CALENDAR_IDS`: Paste the Calendar IDs of your source calendars here.
*   `DESTINATION_CALENDAR_ID`: Paste the Calendar ID of your "My Availability" calendar.
*   `EVENT_TITLE`: The default title for synced events if no custom title is specified (e.g., "Busy", "Unavailable").
*   `CALENDAR_NAMES`: (Optional) A mapping of calendar IDs to custom event titles. Example:
    ```
    const CALENDAR_NAMES = {
      "your_personal_email@gmail.com": "Personal",
      "work_calendar@group.calendar.google.com": "Work",
      "school_calendar@group.calendar.google.com": "Class"
    };
    ```
    Keys should match entries in `SOURCE_CALENDAR_IDS`. If a calendar ID is not found here, the script uses the `EVENT_TITLE`.
*   `SYNC_START_DATE`: The earliest date the script should look for events during manual full sync runs.
*   `TIMEZONE`: (Optional) Set your local timezone (e.g., "America/New_York", "Europe/London"). Leave blank to let the script dynamically detect your timezone.
*   `SYNC_DAYS_BEFORE`: The number of days in the past to sync on every execution (default: 7).
*   `SYNC_DAYS_AFTER`: The number of days in the future to sync on every execution (default: 30).

### **Step 6: Set Up the Trigger**

You only need one trigger to run the script automatically.

1.  On the left-hand menu of the script editor, click the clock icon (**Triggers**).
2.  Click **+ Add Trigger** and set up the main sync trigger:
    *   **Function to run:** `processSyncBatch`
    *   **Deployment to run from:** `Head`
    *   **Event source:** `Time-driven`
    *   **Type of time-based trigger:** `Minutes timer`
    *   **Minute interval:** `Every 5 minutes` (Recommended sweet spot for immediate syncing and rate limit safety).
    *   Click **Save**.

### **Step 7: Authorize the Script**

The first time you save a trigger, Google will require you to authorize the script.

1.  A pop-up will appear. Click **Review permissions**.
2.  Choose your Google account.
3.  You will see a screen saying **"Google hasn't verified this app"**. This is normal because you are the user. Click **Advanced**, then click **Go to [Your Project Name] (unsafe)**.
4.  Review the permissions and click **Allow**.

Your setup is now complete! The script will begin its rolling sync on the next trigger and will keep your availability calendar updated automatically.

## **Sharing Your Availability Calendar**

Once the script is running, you can share your availability calendar with others so they can see your free/busy times.

### **Step 1: Make Your Calendar Public**

1. In Google Calendar, find your "My Availability" calendar (or whatever you named it) in the list on the left.
2. Click the three-dots menu (⋮) next to it and select **Settings and sharing**.
3. Under **Access permissions for events**, check the box for **Make available to public**.
4. A warning will appear. Click **OK**. You can choose to either show all event details or only free/busy information. Since the script only creates generic "Busy" or custom-named blocks, it's safe to select **See all event details**.

### **Step 2: Get the Public URL**

1. In the same **Settings and sharing** page, scroll down to the **Integrate calendar** section.
2. Copy the **Public URL to this calendar**.
3. Share this URL with anyone who needs to see your availability. When they open the link, they will see a web view of your availability calendar.

### **Step 3: (Optional) Share the iCal Address**

For users who want to subscribe to your calendar in their own calendar app (like Outlook, Apple Calendar, or another Google Calendar account):

1. In the **Integrate calendar** section, find the **Public address in iCal format**.
2. Copy this URL.
3. Provide this link to others. They can use it to add your availability calendar directly to their own calendar application, and it will stay updated automatically.

## **Advanced Usage**

### **Running a Full Manual Sync**

If you ever need to do a complete, comprehensive sync over a long period of time (e.g., after changing the `SYNC_START_DATE`), you can manually run the `runFullSync` function. This is not required for normal operation.

1. In the script editor, select the function `runFullSync` from the dropdown menu at the top.
2. Click the **Run** button.
3. Check the **Execution log** to monitor its progress.

### **Overlap Consolidation and Self-Healing**

When the script runs, it automatically merges overlapping and adjacent events from your source calendars into single, smooth unavailability blocks. 
* **Self-Healing:** On the very first run of this updated script, it will automatically clean up any existing overlapping blocks that were left by the old script. It deletes the legacy overlapping events and replaces them with consolidated single-block events automatically.
* **Combined Titles:** If a "Work" event and a "Personal" event overlap, the synced event is dynamically titled `Work & Personal`.
* **Details in Description:** The synced event's description will detail the contributing sources, e.g., `sync-id:auto-generated | Sources: Work, Personal`.

### **Clearing Legacy Properties**

The modernized rolling window sync no longer relies on the legacy `syncCursor` state or nightly reset properties. If you want to keep your project properties clean, you can manually run the `resetSync` function once:

1. In the script editor, select the function `resetSync` from the dropdown menu at the top.
2. Click the **Run** button.

This will clear any old sync cursors from your Script Properties.

## **License**

This project is licensed under the Apache License 2.0. See the [LICENSE](LICENSE) file for details.
