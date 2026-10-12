# Tuck competition walkthrough (approximately 90 seconds)

Use the **actual deployed static web build**, not Metro. This is a suggested presentation sequence, not a claim that a live recording has been made.

1. **Open the hosted Tuck library.** Point out the compact folded-note identity, saved examples, and navigation. Explain that a note, a URL and an image can be kept in one calm workspace.
2. **Create a note** using the visible “Tuck something” action. Add a title, content and relevant tags; save it. The resulting card should appear in the library.
3. **Organise it** into a Collection and **pin** it. Show filtering/search and open the item to edit it.
4. **Archive and restore** the note. Explain the difference between putting something away and permanently deleting it.
5. **Refresh** the browser. Show that local IndexedDB persists the edited content in the same browser profile.
6. **Switch viewport** to mobile width; briefly show the responsive library/editor. If an actual standalone APK exists, open it on Android with the development laptop disconnected and show local SQLite persistence independently.

**Required disclosure:** The competition demo stores content locally in each browser/device; it is not a multi-device cloud-sync demo. The repository retains future Supabase/sync infrastructure, but competition entry points do not enable it. Do not claim AI-powered retrieval or deployed cloud synchronization.

## Evidence to capture, if required by the submission portal

- real deployed web page with URL visible
- new note and Collection
- search/pin/archive operations
- persisted note after refresh
- narrow-viewport responsive view
- Android standalone launch only if independently built and installed
