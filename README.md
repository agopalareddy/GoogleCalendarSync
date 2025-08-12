# **Google Calendar Availability Sync**

A Google Apps Script to automatically sync events from multiple source calendars to a single "Availability" calendar. This script creates generic "Busy" or "Unavailable" blocks of time, allowing you to share your availability without revealing the private details of your appointments.

## **Features**

*   **One-Way Sync:** Copies events from multiple source calendars to one destination calendar.
*   **Privacy-Focused:** Creates generic events, hiding original titles, descriptions, and guest lists.
*   **Robust Reconciliation:** A powerful reconciliation model accurately creates and deletes events, preventing duplicate or orphaned entries.
*   **Automatic Deletion:** Automatically removes "Busy" blocks when the original event is deleted or its time is changed.
*   **Manual Event Protection:** Allows you to manually add events to the destination calendar without the script deleting them.
*   **Resilient and Efficient:** Uses a batch processing model with a "sync cursor" to work within Google's execution time limits and pick up where it left off.
*   **Automatic Nightly Reset:** The sync cursor automatically resets every morning, ensuring the script re-validates recent events and maintains long-term accuracy without needing a separate trigger.

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
*   `EVENT_TITLE`: Change the title of the synced events if you wish (e.g., "Busy", "Unavailable").
*   `SYNC_START_DATE`: Set the earliest date the script should look for events. This prevents it from syncing very old events.

### **Step 6: Set Up the Trigger**

You only need one trigger to run the script automatically.

1.  On the left-hand menu of the script editor, click the clock icon (**Triggers**).
2.  Click **+ Add Trigger** and set up the main sync trigger:
    *   **Function to run:** `processSyncBatch`
    *   **Deployment to run from:** `Head`
    *   **Event source:** `Time-driven`
    *   **Type of time-based trigger:** `Minutes timer`
    *   **Minute interval:** `Every 15 minutes` (Recommended) or `Every 30 minutes`.
    *   Click **Save**.

### **Step 7: Authorize the Script**

The first time you save a trigger, Google will require you to authorize the script.

1.  A pop-up will appear. Click **Review permissions**.
2.  Choose your Google account.
3.  You will see a screen saying **"Google hasn't verified this app"**. This is normal because you are the developer. Click **Advanced**, then click **Go to [Your Project Name] (unsafe)**.
4.  Review the permissions and click **Allow**.

Your setup is now complete! The script will begin its initial sync on the next trigger and will keep your availability calendar updated automatically.

## **Advanced Usage**

### **Running a Full Manual Sync**

If you ever need to do a complete, comprehensive sync over a long period of time (e.g., after changing the `SYNC_START_DATE`), you can manually run the `runFullSync` function. This is not required for normal operation.

1.  In the script editor, select the function `runFullSync` from the dropdown menu at the top.
2.  Click the **Run** button.
3.  Check the **Execution log** to monitor its progress.

### **Resetting the Sync**

If you need to force the script to re-sync all events from the very beginning (`SYNC_START_DATE`), you can manually run the `resetSync` function.

1.  In the script editor, select the function `resetSync` from the dropdown menu at the top.
2.  Click the **Run** button.

This will clear the script's memory of its last sync position and its last reset date. The next time the trigger runs `processSyncBatch`, it will start a full historical sync from the beginning.

## **License**

This project is licensed under the Apache License 2.0. See the [LICENSE](LICENSE) file for details.
