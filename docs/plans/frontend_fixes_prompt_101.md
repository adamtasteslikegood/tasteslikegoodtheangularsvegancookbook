ok while we're working on the frontend  i ha ve a short list of basic  functions that shouold be  fixed or implemented (we can make the changes and deploy revision in whatever order you think best, i.e small steps to check if changes are working before makeing more changes:

##  Changes:

- [x] Regenerate missing images (done!)
- [ ]  Problem:  `New Cookbook` Pop-up displays behind `Add to Cookbook` pop-up window, when `New Cookbook` window is launched from the `+ New` button on the `Add too Cookbook` window..
  - [ ] This situation occurs whenever there is a new user or guest and there are no cookbooks too add recipe too so user clicks the `new` button in the  `add to cookbook` window and the
  'New Cookbook` dialog/window  opens behind the open `add to cookbook` window and is completly blocked. Since this is one of the first imprressions of interacting with hte
  save/cookbook feature of the site , i assign high priority too this fix
- [ ] Feat change: While were updating the `Add to Cookbook` pop-up window., another feat that is missing from the site is the basic c.ru.d. functions for the cookbook and recipes.. The pop-up window should support both selecting multiple cookbooks too add recipe too, the new cookbook {which exist and looks great where it is and already went over changes too the visual workflow). And unchecking the cookbooks that are selected.
- [ ]  the  'add to cookbook'  window should have a ok/confrim and 'cancel' button at the bottom, so it can serve as a mini-version of cookbook management, as it applies too the recipe (or recipes once selecting multiple recipes implemented). Users can click on the cookbook titles to check cookbooks that the recipe appears in (as it works now), but click action should toggle the selections/checkmarks (not add to one cookbook and close the dialog window as it does now).  and even adding new cookbook from the `add to cookbook` pop-up window, should bring the user back to the `add to ..` window. (now the user is returned too the main page and has to repeat the steps after adding a new cookbook from the add recipe too window).
    - [ ]  Select/de-select cookbooks from lsit in `add to...` window:  Finally after the user has selected one or more cookbooks to add recipe too (or has toggled existing 'checked' cookbook list items) or remove recipe from..
    - [ ]  The Confim/Ok button should make the changes, if there are cookbooks being removed from there should 100% be a confirmation dialog,
    - [ ]  Confirmation popup:  could always have a window that lists proposed updates too cookbooks with confirm cancel.
-  [ ] Add full C.R.U.D. functionality too recipes and  cookbooks. Users should be able too create, and also delete recipes and cookbooks. Deleted recipes should have a confirmation before deletion and there should be a special cookbook named 'Recently Deleted or Recycle Bin (*go with `Recycle Bin '  name)  that stores recently deleted recipes/cookbooks.
- [ ]  Clicking in the user name icon should display a minimal expanded user profile with display name and avatar/member since?
- Image window should be a mini-gallery that allows up too 5 ai_generated images and also basic crud (lets push this feat update too the next round) :
- Next pass: Add more recipe/cookbook management features.. multiselect, sort and filter etc.