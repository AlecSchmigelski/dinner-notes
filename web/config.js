// Deploy-time settings. The Settings screen on the phone can override apiUrl.
window.DINNER_NOTES = {
  // The deployed Worker URL.
  apiUrl: "https://dinner-notes.aftertaste-app.workers.dev",
  // A link that opens the Beli app after copying. Beli publishes no universal
  // links, so leave this empty until a scheme is confirmed on her phone
  // (try "beli://"). Empty means copy only.
  beliUrl: "",
};
