# **Google Calendar Availability Sync**

A Google Apps Script to automatically sync events from multiple source calendars to a single "Availability" calendar. This script creates generic "Busy" or "Unavailable" blocks of time, allowing you to share your availability without revealing the private details of your appointments.

## **Features**

* **One-Way Sync:** Copies events from multiple source calendars to one destination calendar.  
* **Privacy-Focused:** Creates generic events, hiding original titles, descriptions, and guest lists.  
* **Automatic Deletion:** Automatically removes "Busy" blocks when the original event is deleted.  
* **Manual Event Protection:** Allows you to manually add events to the destination calendar without the script deleting them.  
* **Robust & Resilient:** Uses batch processing and state management to work within Google's execution time limits and recover from errors.  
* **Nightly Safeguard:** A full-sync function runs nightly to catch any discrepancies and ensure long-term accuracy.

## **Setup Instructions**

Follow these steps to get the script running in your own Google account.

### **Step 1: Create Your Calendars**

1. Ensure you have your primary calendars ready (e.g., Personal, Work, School).  
2. In Google Calendar, create a **new, separate calendar**. Name it something clear like "My Availability" or "Public Schedule". This will be your destination calendar.

### **Step 2: Get Your Calendar IDs**

You will need the unique ID for each of your source calendars and your new destination calendar.

1. In Google Calendar, find a calendar in the list on the left.  
2. Click the three-dots menu (⋮) next to it and select **Settings and sharing**.  
3. Scroll down to the **Integrate calendar** section.  
4. Copy the **Calendar ID** (it often looks like an email address).  
5. Repeat this for all your source calendars and the destination calendar.

### **Step 3: Create the Google Apps Script Project**

1. Go to [script.google.com](script.google.com).  
2. Click **New project** in the top-left.  
3. Give the project a name, like "Calendar Sync Service".

### **Step 4: Add the Code**

1. Delete any placeholder code in the editor.  
2. Copy the entire contents of the Code.gs file from this repository and paste it into the script editor.  
3. Click the **Save project** icon.

### **Step 5: Configure the Script**

In the Code.gs file, find the CONFIGURATION section at the top and replace the placeholder values with your own.

* SOURCE\_CALENDAR\_IDS: Paste the Calendar IDs of your source calendars here.  
* DESTINATION\_CALENDAR\_ID: Paste the Calendar ID of your "My Availability" calendar.  
* EVENT\_TITLE: Change the title of the synced events if you wish (e.g., "Busy").

### **Step 6: Set Up Triggers**

You need two triggers to run the script automatically.

1. On the left-hand menu of the script editor, click the clock icon (**Triggers**).  
2. Click **\+ Add Trigger** and set up the **hourly trigger**:  
   * **Function to run:** processSyncBatch  
   * **Event source:** Time-driven  
   * **Type of time-based trigger:** Hour timer  
   * **Hour interval:** Every hour  
   * Click **Save**.  
3. Click **\+ Add Trigger** again and set up the **nightly trigger**:  
   * **Function to run:** runFullSync  
   * **Event source:** Time-driven  
   * **Type of time-based trigger:** Day timer  
   * **Time of day:** Midnight to 1am  
   * Click **Save**.

### **Step 7: Authorize the Script**

The first time you save a trigger, Google will require you to authorize the script.

1. A pop-up will appear. Click **Review permissions**.  
2. Choose your Google account.  
3. You will see a screen saying **"Google hasn't verified this app"**. This is normal because you are the developer. Click **Advanced**, then click **Go to \[Your Project Name\] (unsafe)**.  
4. Review the permissions and click **Allow**.

Your setup is now complete\! The script will begin its initial sync on the next hourly trigger and will keep your availability calendar updated automatically.

## **License**

This project is licensed under the Apache License 2.0. See the [LICENSE](https://github.com/agopalareddy/GoogleCalendarSync/tree/main?tab=Apache-2.0-1-ov-file) file for details.
