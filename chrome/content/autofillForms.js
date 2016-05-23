/*
 * @package autofillForms
 * @author Sebastian Tschan
 * @copyright (c) Sebastian Tschan
 * @license GNU General Public License
 * @link https://blueimp.net/mozilla/
 */

var autofillForms = {
  require: (function () {
    var {require} = Components.utils.import("resource://gre/modules/commonjs/toolkit/require.js", {});
    return require ? {
      Worker: require('sdk/content/worker').Worker,
      utils: require('sdk/tabs/utils'),
      tabs: require('sdk/tabs')
    } : {};
  })(),

  // The selected profile index:
  profileIndex: null,
  // The selected global profile index:
  globalProfileIndex: null,
  // The selected form fields context menu profile index
  formFieldsContextMenuProfileIndex: null,
  // The list of profile labels:
  profileLabels: null,
  // The list of profile site rules:
  profileSiteRules: null,
  // The list of form field rules:
  fieldRules: null,
  // The tree representing the field rules list:
  tree: null,
  // The tree view:
  treeView: null,
  // The tree view frontend:
  treeBox: null,
  // Holds the selection object for the treeview:
  selection: null,
  // Remembers the last selected index of the treeview:
  lastSelectedIndex: null,
  // Determines if sort is to be ascending or descending:
  ascending: null,
  // The profiles listBox:
  profilesTree: null,
  // The profiles tree view:
  profilesTreeView: null,
  // The profiles tree view frontend:
  profilesTreeBox: null,
  // Holds the selection object for the profiles treeview:
  profilesSelection: null,
  // The profiles sort order:
  profilesAscending: null,
  // Autofill forms preferences branch:
  autofillFormsPrefs: null,
  // Object containing the shortcuts information (modifiers, key or keycode):
  shortcut: null,
  // Object containing the mouse button shortcuts information:
  mouseButton: null,
  // Helper var to do the opposite of the current setting:
  invertedSetting: null,
  // Array containing the rule element types ("begins with", "contains", ...):
  ruleElementTypes: null,
  // Containes the reference to the current rule field:
  currentRuleField: null,
  // Defines the index selected for the last alternative fieldRules selection:
  fieldRuleAlternativesIndex: null,
  // Stores the length of the last created list of alternative fieldRules:
  fieldRuleAlternativesLength: null,
  // Hash to store lists of alternatives (used for radio input fields):
  fieldRuleAlternativesHash: null,
  // Cache to reuse/clone fieldRuleAlternatives on the same form fill run:
  fieldRuleAlternativesCache: null,
  // Array of dynamic tags:
  dynamicTags: null,
  // Array of dynamic tag codes, associated to the dynamic tags:
  dynamicTagCodes: null,
  // Determines if a textbox is focused on the rule editor:
  ruleEditorTextBoxFocused: null,
  // Determines if a textbox is focused on the tag editor:
  tagEditorTextBoxFocused: null,
  // References the last matched form element (used to set the focus):
  lastFormElementMatch: null,
  // References the current window when filling out forms:
  currentWindow: null,
  // Holds the index of the current form when filling out forms:
  currentFormIndex:null,
  // Holds the index of the current form element when filling out forms:
  currentElementIndex: null,
  // References the target form field on which the context menu has been invoked:
  targetFormField: null,
  // Event listener for the content area context menu:
  contentAreaContextMenuEventListener: null,
  // Holds the the tooltip grid which displays commands and their mouse buttons and keyboard shortcuts:
  tooltipGrid: null,
  // Holds the current profile tooltip label:
  tooltipCurrentProfile: null,
  // Keep track of open dialogs
  currentDialogs: null,
  // current version number
  version: "1.0.4",

  action: function (elem, cmd, val) {
    console.error(cmd);
    elem.setAttribute('data-aff-' + cmd, val);

    var doc = elem.ownerDocument;

    function oldMethod () {
      console.error('old Method');
      var wm = Components.classes['@mozilla.org/appshell/window-mediator;1']
        .getService(Components.interfaces.nsIWindowMediator);
      var browser = wm.getMostRecentWindow('navigator:browser').gBrowser.selectedBrowser;
      var mm = browser.messageManager;
      if (!browser.slScript) {
        mm.loadFrameScript('chrome://autofillforms/content/inject.js', true);
        browser.slScript = true;
      }
      mm.sendAsyncMessage(cmd);
    }

    if ('Worker' in autofillForms.require && doc) {
      var contentWindow = doc.defaultView || doc.parentWindow;
      if (contentWindow) {
        var tab = autofillForms.require.utils.getTabForContentWindow(contentWindow);
        if (tab) {
          var tabId = autofillForms.require.utils.getTabId(tab);
          for each (let sdkTab in autofillForms.require.tabs) {
            if (sdkTab && sdkTab.id === tabId) {
              let worker = sdkTab.attach({
                contentScriptFile: 'resource://autofillforms/sdk.js',
              });
              worker.port.on('done', function () {
                worker.destroy();
              });
              worker.port.emit(cmd, val);
              return;
            }
          }
        }
      }
      oldMethod();
    }
    else {
      oldMethod();
    }
  },

  initialize: function () {

    // Save the reference to the Autofill Forms preferences branch:
    this.autofillFormsPrefs = this.getPrefManager().getBranch('extensions.autofillForms@blueimp.net.');

    // Add a preferences observer to the autofillForms preferences branch:
    this.autofillFormsPrefs.QueryInterface(Components.interfaces.nsIPrefBranch2);
     this.autofillFormsPrefs.addObserver('', this, false);

    // Implement the event listener for the content area context menu:
    this.contentAreaContextMenuEventListener = function (event) {
      autofillForms.initContentAreaContextMenu(event);
    };

    // Initialize the preferences settings:
    this.initializePrefs();

    var self = this;
    document.addEventListener("SSTabRestored", function (event) {
      function welcome (version) {
        var pre = self.autofillFormsPrefs.getCharPref("version");
        if (pre === version || !self.autofillFormsPrefs.getBoolPref("welcome")) {
          return;
        }
        //Showing welcome screen
        setTimeout(function () {
          try {
            var newTab = getBrowser().addTab(self.autofillFormsPrefs.getCharPref("post_install_url") + "?v=" + version + (pre ? "&p=" + pre + "&type=upgrade" : "&type=install"));
            getBrowser().selectedTab = newTab;
          }catch (e) {}
        }, 5000);
        self.autofillFormsPrefs.setCharPref("version", version);
      }

      //Detect Firefox version
      var version = "";
      try {
        version = (navigator.userAgent.match(/Firefox\/([\d\.]*)/) || navigator.userAgent.match(/Thunderbird\/([\d\.]*)/))[1];
      } catch (e) {}
      //FF < 4.*
      var versionComparator = Components.classes["@mozilla.org/xpcom/version-comparator;1"]
        .getService(Components.interfaces.nsIVersionComparator)
        .compare(version, "4.0");
      if (versionComparator < 0) {
        var addon = qfnServices.extMan.getItemForID("autofillForms@blueimp.net");
        welcome(addon.version);
      }
      //FF > 4.*
      else {
        Components.utils.import("resource://gre/modules/AddonManager.jsm");
        AddonManager.getAddonByID("autofillForms@blueimp.net", function(addon) {
          welcome(addon.version);
        });
      }
    });
  },

  initContentAreaContextMenu: function(event) {
    var cm0 = document.getElementById('autofillFormsContextMenuItem');
    var cm1 = document.getElementById('autofillFormsContextMenu');
    var cm2 = document.getElementById('autofillFormsManualFillContextMenu');
    var cm3 = document.getElementById('autofillFormsAddRuleContextMenuItem');
    var cm4 = document.getElementById('autofillFormsAddFormAsProfileContextMenuItem');
    var cm5 = document.getElementById('autofillFormsContextMenuSeparator1');
    var cm6 = document.getElementById('autofillFormsContextMenuSeparator2');
    var cm7 = document.getElementById('autofillFormsDisplayFormDetailsContextMenuItem');
    if(cm0 && gContextMenu) {
      if(gContextMenu.target && this.isValidFormField(gContextMenu.target)) {
        cm0.hidden = true;
        cm1.hidden = true;
        if(this.autofillFormsPrefs.getBoolPref('hideFormFieldsContextMenu')) {
          cm2.hidden = true;
          cm3.hidden = true;
          cm4.hidden = true;
          cm5.hidden = true;
          cm6.hidden = true;
          cm7.hidden = true;
          this.targetFormField = null;
        } else {
          cm2.hidden = false;
          cm3.hidden = false;
          cm4.hidden = false;
          // Show menuseparators if not already separated:
          if(this.isPreviousNodeSeparated(cm5)) {
            cm5.hidden = true;
          } else {
            cm5.hidden = false;
          }
          if(this.isNextNodeSeparated(cm6)) {
            cm6.hidden = true;
          } else {
            cm6.hidden = false;
          }
          this.targetFormField = gContextMenu.target;
        }
        return;
      }

      if(this.autofillFormsPrefs.getBoolPref('hideContextMenuItem')
        || gContextMenu.isContentSelected
        || gContextMenu.onTextInput
        || gContextMenu.onImage
        || gContextMenu.onLink
        || gContextMenu.onCanvas
        || gContextMenu.onMathML
        || !this.getDoc().forms
        || !this.getDoc().forms.length) {
        cm0.hidden = true;
        cm1.hidden = true;
        cm5.hidden = true;
        cm6.hidden = true;
        cm7.hidden = true;
      } else {
        if(this.getProfileLabels().length == 1) {
          cm0.hidden = false;
          cm1.hidden = true;
        } else {
          cm0.hidden = true;
          cm1.hidden = false;
        }
        // Show menuseparators if not already separated:
        if(this.isPreviousNodeSeparated(cm5)) {
          cm5.hidden = true;
        } else {
          cm5.hidden = false;
        }
        if(this.isNextNodeSeparated(cm6)) {
          cm6.hidden = true;
        } else {
          cm6.hidden = false;
        }
        cm7.hidden = false;
      }
      cm2.hidden = true;
      cm3.hidden = true;
      cm4.hidden = true;
      this.targetFormField = null;
    }
  },

  isNextNodeSeparated: function(node) {
    while(node) {
      node = node.nextSibling
      if(node.hidden) {
        continue;
      }
      if(node.nodeName == 'menuseparator') {
        return true;
      } else {
        return false;
      }
    }
    return true;
  },

  isPreviousNodeSeparated: function(node) {
    while(node) {
      node = node.previousSibling;
      if(node.hidden) {
        continue;
      }
      if(node.nodeName == 'menuseparator') {
        return true;
      } else {
        return false;
      }
    }
    return true;
  },

  initializePrefs: function() {
    // Initialize the keyboard shortcut object container:
    this.shortcut = new Object();
    this.shortcut['shortcut'] = null;
    this.shortcut['shortcutSubmit'] = null;
    this.shortcut['shortcutAllTabs'] = null;
    this.shortcut['shortcutFromProfileSelection'] = null;
    this.shortcut['shortcutProfile'] = null;
    this.shortcut['shortcutSettings'] = null;
    this.shortcut['shortcutDisplayFormDetails'] = null;
    for(var property in this.shortcut) {
      this.updateShortcut(property);
    }
    // Initialize toolbar and statusbar icons and context menu:
    this.hideToolbarButtonUpdate();
    this.hideToolbarButtonMenuUpdate();
    this.hideStatusbarIconUpdate();
    this.hideContextMenuItemUpdate();
  },

  observe: function(subject, topic, data) {
    // Only observe preferences changes:
    if (topic != 'nsPref:changed')
      return;
    switch(data) {
      case 'profileIndex':
        // If set to null, the profileIndex will be updated on next getProfileIndex() call:
        this.profileIndex = null;
        this.tooltipCurrentProfile = null;
        break;
      case 'globalProfileIndex':
        // If set to null, the globalProfileIndex will be updated on next getGlobalProfileIndex() call:
        this.globalProfileIndex = null;
        break;
      case 'formFieldsContextMenuProfileIndex':
        // If set to null, the formFieldsContextMenuProfileIndex will be updated on next getFormFieldsContextMenuProfileIndex() call:
        this.formFieldsContextMenuProfileIndex = null;
        break;
      case 'profileLabels':
        // If set to null, the profileLabels will be updated on next getProfileLabels() call:
        this.profileLabels = null;
        this.tooltipCurrentProfile = null;
        break;
      case 'profileSiteRules':
        // If set to null, the profileSiteRules will be updated on next getProfileSiteRules() call:
        this.profileSiteRules = null;
        break;
      case 'shortcut':
        this.updateShortcut('shortcut');
        this.tooltipGrid = null;
        break;
      case 'shortcutSubmit':
        this.updateShortcut('shortcutSubmit');
        this.tooltipGrid = null;
        break;
      case 'shortcutAllTabs':
        this.updateShortcut('shortcutAllTabs');
        this.tooltipGrid = null;
        break;
      case 'shortcutFromProfileSelection':
        this.updateShortcut('shortcutFromProfileSelection');
        this.tooltipGrid = null;
        break;
      case 'shortcutProfile':
        this.updateShortcut('shortcutProfile');
        this.tooltipGrid = null;
        break;
      case 'shortcutSettings':
        this.updateShortcut('shortcutSettings');
        this.tooltipGrid = null;
        break;
      case 'shortcutDisplayFormDetails':
        this.updateShortcut('shortcutDisplayFormDetails');
        this.tooltipGrid = null;
        break;
      case 'mouseShortcut':
        if(this.mouseButton) {
          this.mouseButton['mouseShortcut'] = null;
          this.tooltipGrid = null;
        }
        break;
      case 'mouseShortcutSubmit':
        if(this.mouseButton) {
          this.mouseButton['mouseShortcutSubmit'] = null;
          this.tooltipGrid = null;
        }
        break;
      case 'mouseShortcutAllTabs':
        if(this.mouseButton) {
          this.mouseButton['mouseShortcutAllTabs'] = null;
          this.tooltipGrid = null;
        }
        break;
      case 'mouseShortcutFromProfileSelection':
        if(this.mouseButton) {
          this.mouseButton['mouseShortcutFromProfileSelection'] = null;
          this.tooltipGrid = null;
        }
        break;
      case 'mouseShortcutProfile':
        if(this.mouseButton) {
          this.mouseButton['mouseShortcutProfile'] = null;
          this.tooltipGrid = null;
        }
        break;
      case 'mouseShortcutSettings':
        if(this.mouseButton) {
          this.mouseButton['mouseShortcutSettings'] = null;
          this.tooltipGrid = null;
        }
        break;
      case 'mouseShortcutDisplayFormDetails':
        if(this.mouseButton) {
          this.mouseButton['mouseShortcutDisplayFormDetails'] = null;
          this.tooltipGrid = null;
        }
        break;
      case 'fieldRules':
        if(!this.autofillFormsPrefs.getBoolPref('useConfigDirectory')) {
          // If set to null, the fieldRules will be updated on next getFieldRules() call:
          this.fieldRules = null;
        }
        break;
      case 'storeEncrypted':
        // To update the stored data, we must decrypt or may not decrypt
        // the prefString in opposition to the setting which just changed -
        // the "invertedSetting" helper var helps to identify this situation:
        this.invertedSetting = true;
        // Store data encrypted/decrypted:
        this.setFieldRules();
        this.invertedSetting = false;
        break;
      case 'dynamicTags':
        // If set to null, the dynamicTags will be updated on next getDynamicTags() call:
        this.dynamicTags = null;
        break;
      case 'dynamicTagCodes':
        // If set to null, the dynamicTagCodes will be updated on next getDynamicTagCodes() call:
        this.dynamicTagCodes = null;
        break;
      case 'hideContextMenuItem':
        this.hideContextMenuItemUpdate();
        break;
      case 'hideFormFieldsContextMenu':
        this.hideContextMenuItemUpdate();
        break;
      case 'hideStatusbarIcon':
        this.hideStatusbarIconUpdate();
        break;
      case 'hideToolbarButton':
        this.hideToolbarButtonUpdate();
        this.hideToolbarButtonMenuUpdate();
        break;
      case 'hideToolbarButtonMenu':
        this.hideToolbarButtonMenuUpdate();
        break;
      case 'useConfigDirectory':
        if(this.autofillFormsPrefs.getBoolPref('useConfigDirectory')) {
          this.exportToConfigDirectory();
        } else {
          this.importFromConfigDirectory();
        }
        break;
    }
  },

  hideContextMenuItemUpdate: function() {
    var contentAreaContextMenu = document.getElementById('contentAreaContextMenu');
    if(contentAreaContextMenu) {
      if(!this.autofillFormsPrefs.getBoolPref('hideContextMenuItem')
        || !this.autofillFormsPrefs.getBoolPref('hideFormFieldsContextMenu')) {
        // Add the content area context menu listener:
        contentAreaContextMenu.addEventListener(
          'popupshowing',
          this.contentAreaContextMenuEventListener,
          false
        );
      } else {
        var cm0 = document.getElementById('autofillFormsContextMenuItem');
        var cm1 = document.getElementById('autofillFormsContextMenu');
        var cm2 = document.getElementById('autofillFormsManualFillContextMenu');
        var cm3 = document.getElementById('autofillFormsAddRuleContextMenuItem');
        var cm4 = document.getElementById('autofillFormsAddFormAsProfileContextMenuItem');
        var cm5 = document.getElementById('autofillFormsContextMenuSeparator1');
        var cm6 = document.getElementById('autofillFormsContextMenuSeparator2');
        if(cm0) {
          cm0.hidden = true;
          cm1.hidden = true;
          cm2.hidden = true;
          cm3.hidden = true;
          cm4.hidden = true;
          cm5.hidden = true;
          cm6.hidden = true;
        }
        // Remove the content area context menu listener:
        this.targetFormField = null;
        contentAreaContextMenu.removeEventListener(
          'popupshowing',
          this.contentAreaContextMenuEventListener,
          false
        );
      }
    }
  },

  hideStatusbarIconUpdate: function() {
    // Change the statusbar icon visibility:
    var autofillFormsPanelIcon = document.getElementById('autofillFormsPanelIcon');
    if(autofillFormsPanelIcon) {
      autofillFormsPanelIcon.setAttribute(
        'hidden',
        this.autofillFormsPrefs.getBoolPref('hideStatusbarIcon')
      );
    }
  },

  installToolbarButton: function(buttonID, beforeNodeID, toolbarID) {
    beforeNodeID = beforeNodeID ? beforeNodeID : 'home-button';
    toolbarID = toolbarID ? toolbarID : 'navigation-toolbar';
    if(!document.getElementById(buttonID)) {
      var toolbar = document.getElementById(toolbarID);
      if(!toolbar) {
        // Firefox < 3:
        toolbar = document.getElementById('nav-bar');
      }
      if(toolbar && 'insertItem' in toolbar) {
        var beforeNode = document.getElementById(beforeNodeID);
        if(beforeNode && beforeNode.parentNode != toolbar) {
          beforeNode = null;
        }
        // Insert before the given node or at the end of the toolbar if the node is not available:
        toolbar.insertItem(buttonID, beforeNode, null, false);
        toolbar.setAttribute('currentset', toolbar.currentSet);
        document.persist(toolbar.id, 'currentset');
      }
    }
  },

  hideToolbarButtonUpdate: function() {
    var autofillFormsButton = document.getElementById('autofillFormsButton');
    var hideToolbarButton = this.autofillFormsPrefs.getBoolPref('hideToolbarButton');
    if(!autofillFormsButton && !hideToolbarButton) {
      // Add the toolbar button to the toolbar:
      this.installToolbarButton('autofillFormsButton');
      autofillFormsButton = document.getElementById('autofillFormsButton');
    }
    if(autofillFormsButton) {
      autofillFormsButton.setAttribute(
        'hidden',
        hideToolbarButton
      );
    }
  },

  hideToolbarButtonMenuUpdate: function() {
    var autofillFormsButton = document.getElementById('autofillFormsButton');
    if(autofillFormsButton) {
      if(this.autofillFormsPrefs.getBoolPref('hideToolbarButtonMenu')) {
        autofillFormsButton.removeAttribute('type');
      } else {
        autofillFormsButton.setAttribute('type','menu-button');
      }
    }
  },

  commandHandler: function(event) {
    if(typeof event.button == 'undefined') {
      // If no event.button is set, the command has been done by the left mouse button:
      event.button = 0;
    }
    // Recognize the mouse button and perform the associated action:
    var mouseButtonObj = this.recognizeMouseButton(event);
    if(this.getMouseButton('mouseShortcut').equals(mouseButtonObj)) {
      this.fillForms();
    } else if(this.getMouseButton('mouseShortcutSubmit').equals(mouseButtonObj)) {
      this.fillForms(null, null, true);
    } else if(this.getMouseButton('mouseShortcutAllTabs').equals(mouseButtonObj)) {
      this.fillForms(null, null, null, true);
    } else if(this.getMouseButton('mouseShortcutFromProfileSelection').equals(mouseButtonObj)) {
      this.profileSelectionFormFillPopup(event);
    } else if(this.getMouseButton('mouseShortcutProfile').equals(mouseButtonObj)) {
      this.showProfileSwitcher(event);
    } else if(this.getMouseButton('mouseShortcutSettings').equals(mouseButtonObj)) {
      this.showDialog('chrome://autofillForms/content/autofillFormsOptions.xul');
    } else if(this.getMouseButton('mouseShortcutDisplayFormDetails').equals(mouseButtonObj)) {
      this.displayFormDetails();
    }
  },

  clickHandler: function(event) {
    switch(event.button) {
      case 0:
        // The left mouse button is already handled for clicks on the toolbar button,
        // but not for clicks on the status bar icon:
        if(event.target.id == 'autofillFormsPanelIcon') {
          this.commandHandler(event);
        }
        break;
      default:
        this.commandHandler(event);
    }
  },

  profileSelectionFormFillPopup: function(event) {
    var popup = document.getElementById('autofillFormsProfileSelectionPopup');
    if(popup && typeof popup.openPopup == 'function') {
      this.prepareProfileSelectionFormFillMenu(popup);
      // Show the popup menu (only available for Firefox >= 3):
      popup.openPopup(event.target, null, 0, 0, false, true);
    } else {
      this.profileSelectionFormFillPrompt(event);
    }
  },

  prepareProfileSelectionFormFillMenu: function(menupopup) {
    // Remove all children nodes:
    while(menupopup.hasChildNodes()) {
      menupopup.removeChild(menupopup.firstChild);
    }
    var menuitem = document.createElement('menuitem');
    menuitem.setAttribute('class','menuitem-iconic autofillFormsIcon');
    // Add the profile labels as menu items:
    for(var i=0; i < this.getProfileLabels().length; i++) {
      menuitem = menuitem.cloneNode(false);
      menuitem.setAttribute('label', this.getProfileLabel(i));
      menuitem.setAttribute('data-index', i);
      menuitem.addEventListener("command", function () {
        var i = +this.getAttribute('data-index');
        autofillForms.fillForms(null, i);
      });
      menupopup.appendChild(menuitem);
    }
  },

  profileSelectionFormFillPrompt: function(event) {
    // Show a profile selection prompt and fill out forms with the selected profile:
    var list = this.getProfileLabels();
    var selected = {};
    var ok = this.getPrompts().select(
      window,
      this.getStringBundle().getString('profileSelectionFormFillTitle'),
      this.getStringBundle().getString('profileSelectionPrompt'),
      list.length,
      list,
      selected
    );
    if(ok) {
      this.fillForms(null, selected.value);
    }
  },

  fillForms: function(win, profileIndex, autoSubmit, allTabs) {
    if(!win || !win.document) {
      win = this.getWin();
    }

    var currentProfileIndex = this.getProfileIndex();
    var toggleAutoSelectBestProfile;
    if(typeof profileIndex == 'number') {
      // Temporarily set the given profile index:
      this.setProfileIndex(profileIndex);

      if(this.autofillFormsPrefs.getBoolPref('autoSelectBestProfile')) {
        // Temporarily disable autoSelectBestProfile:
        this.autofillFormsPrefs.setBoolPref('autoSelectBestProfile', false);
        toggleAutoSelectBestProfile = true;
      }
    }

    autoSubmit = autoSubmit ? autoSubmit : null;
    if(allTabs) {
      // Fill out forms on all open browser tabs:
      for(var i=0; i<this.getBrowser().browsers.length; i++) {
        this.searchAndFillForms(
          this.getBrowser().getBrowserAtIndex(i).contentWindow,
          autoSubmit
        );
      }
    } else {
      // Fill out forms on the current tab (or the given window object):
      this.searchAndFillForms(win, autoSubmit);
    }

    // Reset Alternatives (including the cache):
    this.fieldRuleAlternativesIndex = null;
    this.fieldRuleAlternativesLength = null;
    this.fieldRuleAlternativesHash = null;
    this.fieldRuleAlternativesCache = null;

    // Reset objects to release used memory:
    this.fieldRules = null;
    this.profileSiteRules = null;
    this.dynamicTags = null;
    this.dynamicTagCodes = null;

    // Reset the selected profile:
    this.setProfileIndex(currentProfileIndex);

    if(toggleAutoSelectBestProfile) {
      // Reenable autoSelectBestProfile:
      this.autofillFormsPrefs.setBoolPref('autoSelectBestProfile', true);
    }
  },

  searchAndFillForms: function(win, autoSubmit) {
    var doc = this.getDoc(win);

    // Check if any web forms are available on the current window:
    if(doc && doc.forms && doc.forms.length > 0) {

      var url = doc.location.href;

      if(this.autofillFormsPrefs.getBoolPref('autoSelectBestProfile')) {
        // Remember the currently selected profile:
        var currentProfileIndex = this.getProfileIndex();
      }

      // Select the best matching profile - returns false if none matches:
      if(!this.selectBestMatchingProfile(url)) {
        return;
      }

      this.currentWindow = win;

      // Holds the form to be submitted:
      var submitForm;
      // Holds the first submit element found on the form:
      var submitElement;

       // Go through the forms:
       for(var i = 0; i < doc.forms.length; i++) {
        this.currentFormIndex = i;

         // The form elements list:
        var elements = doc.forms[i].elements;

        // A hash to store the alternatives for radio input fields:
        this.fieldRuleAlternativesHash = new Object();

        // Go through the form elements:
        for(var j = 0; j < elements.length; j++) {
          this.currentElementIndex = j;

          // Fill out valid form field types:
          if(this.isValidFormField(elements[j])) {
            this.setFormField(elements[j], url);
          }

          // Collect the first submit button of the form if autoSubmit is enabled:
          if(autoSubmit && elements[j].type && elements[j].type == 'submit' && !submitElement) {
            submitElement = elements[j];
          }
        }

        this.applyStoredFieldRulesAlternatives();

        if(autoSubmit) {
          if(this.lastFormElementMatch && this.lastFormElementMatch.form == doc.forms[i]) {
            // Elements have been matched on this form, check the submitElement:
            if(!submitElement) {
              submitElement = this.getImageSubmitButton(doc.forms[i]);
            }
            submitForm = doc.forms[i];
            // Break out of the forms loop:
            break;
          } else {
            submitElement = null;
          }
        }
      }

      if(this.autofillFormsPrefs.getBoolPref('autoSelectBestProfile')) {
        // Reset the selected profile to the manually selected one:
        this.setProfileIndex(currentProfileIndex);
      }

      if(this.lastFormElementMatch && this.autofillFormsPrefs.getBoolPref('focusLastFormElementMatch')) {
        // Set the focus to the last matched form element:
        //this.lastFormElementMatch.focus();
        autofillForms.action(this.lastFormElementMatch, 'focus');
      }

      // Reset the last matched form element:
      this.lastFormElementMatch = null;

      this.currentWindow = null;
      this.currentFormIndex = null;
      this.currentElementIndex = null;

      if (autoSubmit && submitForm) {
        // autoSubmit the form with a click on the submit button if found
        // or else by calling the submit() method on the form:
        if(submitElement) {
          //submitElement.click();
          autofillForms.action(submitElement, 'click');
        } else {
          //submitForm.submit();
          autofillForms.action(submitForm, 'submit');
        }
      }
    }

    // Recursive call for all subframes:
    for(var f=0; f < win.frames.length; f++) {
      this.searchAndFillForms(win.frames[f], autoSubmit);
    }
  },

  getImageSubmitButton: function(form) {
     var inputElements = form.getElementsByTagName('input');
     for(var i = 0; i < inputElements.length; i++) {
      if(inputElements[i].type == 'image') {
        return inputElements[i];
      }
     }
  },

  selectBestMatchingProfile: function(url) {
    if(this.autofillFormsPrefs.getBoolPref('autoSelectBestProfile')) {
      var match;
      // The emtpy siteRule (?:) has a match length of 0, so we set the initial value to -1:
      var maxMatch = -1;
      var index = -1;
      // First test the currently selected profile:
      try {
        match = url.match(new RegExp(this.getProfileSiteRule(this.getProfileIndex()),'i'));
        if(match && (match.toString()).length > maxMatch) {
          maxMatch = (match.toString()).length;
          index = this.getProfileIndex();
        }
      } catch(e) {
        // Catch errors caused by invalid profile site rules
      }
      for(var i=0; i<this.getProfileSiteRules().length; i++) {
        if(i == this.getProfileIndex()) {
          // Skip the current profile (already tested):
          continue;
        }
        try {
          match = url.match(new RegExp(this.getProfileSiteRule(i),'i'));
          if(match && (match.toString()).length > maxMatch) {
            maxMatch = (match.toString()).length;
            index = i;
          }
        } catch(e) {
          // Catch errors caused by invalid profile site rules
        }
      }
      if(index > -1) {
        // Select the profile with the best match:
        this.setProfileIndex(index);
        return true;
      }
    } else {
      try {
        var regExp = new RegExp(this.getProfileSiteRule(this.getProfileIndex()),'i');
        if(regExp.test(url)) {
          return true;
        }
      } catch(e) {
        // Catch errors caused by invalid profile site rules
      }
    }
    return false;
  },

  setFormField: function(element,url) {
    var matchFound = false;

    // Apply the fieldRules of the current profile:
    matchFound = this.applyFieldRulesOnElement(element,url,this.getFieldRules());

    // If no match has been found, apply the fieldRules of the global profile, if enabled:
    if(!matchFound && this.autofillFormsPrefs.getBoolPref('enableGlobalProfile')) {
      // Only apply the global profile fieldRules if the current profile is not the global profile;
      if(this.getProfileIndex() != this.getGlobalProfileIndex()) {
        // Only apply the global profile if the global profile site rule matches the url:
        try {
          var regExp = new RegExp(this.getProfileSiteRule(this.getGlobalProfileIndex()),'i');
          if(regExp.test(url)) {
            matchFound = this.applyFieldRulesOnElement(element,url,this.getGlobalFieldRules());
          }
        } catch(e) {
          // Catch errors caused by invalid profile site rules
        }
      }
    }

    // Highlight styles:
    var highlightStyleMatch = this.autofillFormsPrefs.getCharPref('highlightStyleMatch');
    var highlightStyleNoMatch = this.autofillFormsPrefs.getCharPref('highlightStyleNoMatch');

    if(matchFound) {
      // Set the current element as the last matched form element:
      this.lastFormElementMatch = element;

      if(highlightStyleMatch) {
        // Highlight matched form fieds:
        element.setAttribute('style', highlightStyleMatch);
      }
    } else if(highlightStyleNoMatch) {
      // Highlight not matched form fieds:
      element.setAttribute('style', highlightStyleNoMatch);
    }
  },

  getIndexForFieldRules: function(fieldRules) {
    if(this.fieldRules) {
      for(var i=0; i<this.fieldRules.length; i++) {
        if(this.fieldRules[i] === fieldRules) {
          return i;
        }
      }
    }
    return -1;
  },

  fieldRuleAlternativeFactory: function(fieldRules, index) {
    var af = this;
    if(typeof arguments.callee.fieldRuleAlternative == 'undefined') {
      arguments.callee.fieldRuleAlternative = function(fieldRules, index) {
        this.fieldRules = fieldRules;
        this.index = index;
        this.fieldRule = this.fieldRules[this.index];
        return this;
      }
      arguments.callee.fieldRuleAlternative.prototype = {
        af : af,
        fieldRuleValue: null,
        fieldRuleValueRegExp: null,
        fieldRuleRegExp: null,
        siteRuleRegExp: null,
        optionsIndex: null,
        element: null,
        getValue: function() {
          if(!this.fieldRuleValue) {
            // Replace dynamic tags if enabled:
            if(this.af.autofillFormsPrefs.getBoolPref('enableDynamicTags'))
              this.fieldRuleValue = this.af.replaceDynamicTags(this.fieldRule['fieldRuleValue']);
            else
              this.fieldRuleValue = this.fieldRule['fieldRuleValue'];
          }
          return this.fieldRuleValue;
        },
        getRule: function() {
          return this.fieldRule['fieldRuleFieldRule'];
        },
        getName: function() {
          return this.fieldRule['fieldRuleName'];
        },
        isEnabled: function() {
          return this.fieldRule['fieldRuleEnabled'];
        },
        isURLMatching: function(url) {
          if(this.siteRuleRegExp === null) {
            this.siteRuleRegExp = new RegExp(this.fieldRule['fieldRuleSiteRule'],'i');
          }
          // Test if the siteRule matches the given URL:
          return this.siteRuleRegExp.test(url);
        },
        isRuleMatching: function(str) {
          if(this.fieldRuleRegExp === null) {
            this.fieldRuleRegExp = new RegExp(this.fieldRule['fieldRuleFieldRule'],'i');
          }
          // Test if the fieldRule matches the given string:
          return this.fieldRuleRegExp.test(str);
        },
        isValueMatching: function(str) {
          try {
            if(this.fieldRuleValueRegExp === null) {
              this.fieldRuleValueRegExp = new RegExp(this.getValue(),'i');
            }
            // Test if the value as regular expression matches the given string:
            return this.fieldRuleValueRegExp.test(str);
          } catch(e) {
            // If turning the value into a regular expression fails, compare the strings:
            return (str == this.getValue());
          }
        },
        isOverwrite: function() {
          // This setting defines if existing field contents should be overwritten
          // and if checkboxes and radio buttons should be checked or unchecked
          // and if selection options should be selected or unselected:
          return this.fieldRule['fieldRuleOverwrite']
        },
        getIndex: function() {
          return this.index;
        },
        getOptionsIndex: function() {
          return this.optionsIndex;
        },
        setOptionsIndex: function(optionsIndex) {
          this.optionsIndex = optionsIndex;
        },
        getElement: function() {
          return this.element;
        },
        setElement: function(element) {
          this.element = element;
        },
        clone: function() {
          // This creates only a shallow copy,
          // though we only need a shallow copy:
          var clone = new this.constructor();
          for(var key in this) {
            clone[key] = this[key];
          }
          return clone;
        }
      }
    }
    if(this.fieldRuleAlternativesCache == null) {
      this.fieldRuleAlternativesCache = new Object();
    }
    var identifier = this.getIndexForFieldRules(fieldRules)+'-'+index;
    if(!this.fieldRuleAlternativesCache[identifier]) {
      this.fieldRuleAlternativesCache[identifier] = new arguments.callee.fieldRuleAlternative(
        fieldRules,
        index
      );
    } else {
      // Clone the cached alternative and set the clone as new cached element:
      this.fieldRuleAlternativesCache[identifier] = this.fieldRuleAlternativesCache[identifier].clone()
    }
    return this.fieldRuleAlternativesCache[identifier];
  },

  getLabelForElement: function(element) {
    if(element.form && element.id) {
      // Method to retrieve the textual content of the label assigned to the form element:
      var labels = element.form.getElementsByTagName('label');
      for(var i=0; i<labels.length; i++) {
        if(labels[i].htmlFor && labels[i].htmlFor == element.id) {
          // label elements may contain other inline elements,
          // so we just use the innerHTML content and strip it of all HTML tags
          // whitespace is removed from the beginning and end of the string for convenience:
          return this.trim(this.stripTags(labels[i].innerHTML));
        }
      }
    }
    if(!this.autofillFormsPrefs.getBoolPref('labelsStrictMode')) {
      return this.getLabelCloseToElement(element);
    }
    return null;
  },

  getLabelCloseToElement: function(element) {
    var label = null;
    var node = element;
    var nextNode;
    if(element.type == 'checkbox' || element.type == 'radio') {
      // For checkboxes and radio buttons the label is usually placed as nextSibling:
      nextNode = 'nextSibling';
    } else {
      // For other elements the label is usually placed as previousSibling:
      nextNode = 'previousSibling';
    }
    // Check if a sibling contains the element label:
    while(node[nextNode]) {
      node = node[nextNode];
      label = this.getNodeTextContent(node, true);
      if(label) {
        return label;
      }
    }
    // Parse the siblings of the parentNode:
    node = element.parentNode;
    if(node) {
      while(node[nextNode]) {
        node = node[nextNode];
        label = this.getNodeTextContent(node, true);
        if(label) {
          return label;
        }
      }
      // If the parentNode of the parentNode is a table cell,
      // also parse the siblings of this node:
      node = element.parentNode.parentNode;
      if(node && node.nodeName == 'TD') {
        while(node[nextNode]) {
          node = node[nextNode];
          label = this.getNodeTextContent(node, true);
          if(label) {
            return label;
          }
        }
      }
    }
    return null;
  },

  getNodeTextContent: function(node, trim) {
    // Get the text content from the current node or its child nodes:
    var text;
    if(node.nodeType == 3) {
      // nodeType 3 is a text node:
      text = node.nodeValue;
    } else {
      // Do not follow selection nodes, script nodes or noscript nodes:
      if(node.nodeName == 'SELECT' || node.nodeName == 'SCRIPT' || node.nodeName == 'NOSCRIPT') {
        return '';
      }
      text = '';
      for(var i=0; i<node.childNodes.length; i++) {
        text += this.getNodeTextContent(node.childNodes[i]);
      }
    }
    if(trim) {
      return this.trim(text);
    } else {
      return text;
    }
  },

  applyFieldRulesOnElement: function(element,url,fieldRules) {

    var labelValue = this.autofillFormsPrefs.getBoolPref('matchAgainstLabels') ?
      this.getLabelForElement(element) : null;

    var positionString = this.autofillFormsPrefs.getBoolPref('matchAgainstPositions') ?
      this.currentFormIndex + this.autofillFormsPrefs.getCharPref('positionsIdentifier')
      + this.currentElementIndex : null;

    var fieldRuleAlternatives = new Array();

    // Go through the list of fieldRules:
    for(var i=0; i < fieldRules.length; i++) {

      var rule = this.fieldRuleAlternativeFactory(fieldRules, i);

      // Skip this rule if
      // a) the rule is disabled and disabled rules are to be ignored or
      // b) the current URL is not matching the siteRule or
      // c) all of the following are false:
      //   1) the element name does not match the fieldRule
      //   2) label matching is disabled or the element label does not match the fieldRule
      //   3) the element name is not empty or the element id does not match the fieldRule
      //  4) position matching is disabled or the position does not match the fieldRule
      if(  !rule.isEnabled() &&
        this.autofillFormsPrefs.getBoolPref('ignoreDisabledRulesOnAutofill') ||
        !rule.isURLMatching(url) ||
        (
          !rule.isRuleMatching(element.name) &&
          (labelValue === null || !rule.isRuleMatching(labelValue)) &&
          (element.name || !rule.isRuleMatching(element.id)) &&
          (positionString === null || !rule.isRuleMatching(positionString))
        )
        ) {
        if(fieldRuleAlternatives.length > 0) {
          // Break out of the loop, if we already have an alternative:
          break;
        } else {
          continue;
        }
      }

      if(element.type == 'select-one' || element.type == 'select-multiple') {
        // Go through the selection options:
        for(var j = 0; j < element.options.length; j++) {
          // Match either the value or the text (the selection option label):
          if(rule.isValueMatching(element.options[j].value) || rule.isValueMatching(element.options[j].text)) {
            // Remember the matching option:
            rule.setOptionsIndex(j);
            // Remember the element:
            rule.setElement(element);
            // Add a clone of the alternative and continue to see if the value matches several options:
            fieldRuleAlternatives.push(rule.clone());
          }
        }
      } else if(element.type == 'checkbox' || element.type == 'radio') {
        if(rule.isValueMatching(element.value)) {
          // Remember the element:
          rule.setElement(element);
          // Add the alternative:
          fieldRuleAlternatives.push(rule);
          // Only one rule has to match a checkbox/radio button, so we break out of the loop:
          break;
        }
      } else {
        // Remember the element:
        rule.setElement(element);
        // Add the alternative:
        fieldRuleAlternatives.push(rule);
      }
      if(this.autofillFormsPrefs.getBoolPref('callOnChangeAfterFillingFields')) {
        this.fireEvent(element,'change')
      }
    }

    return this.applyFieldRulesAlternativesOnElement(element,fieldRuleAlternatives);
  },

  applyFieldRulesAlternativesOnElement: function(element,fieldRuleAlternatives) {
    if(fieldRuleAlternatives.length == 0) {
      return false;
    }

    if (this.autofillFormsPrefs.getBoolPref('focusLastFormElementMatch')) {
      //element.focus();
      autofillForms.action(element, 'focus');
    }

    // Add a box (with some help from Mike Ratcliffe)
    // http://groups.google.com/group/firebug/browse_thread/thread/7d4bd89537cd24e7/2c9483d699efe257?hl=en
    // TODO: why doesn't getBoundingClientRect return the absolute coordinates of the element?
    // At the moment, I'm looking at the offset of the doc.body and use that to calculate the absolute coordinates
    // what's the offset -4,+1 pixel relative to? the size of the window border?
    //
    var doc = this.getDoc();
    var div1 = doc.createElement('div');

    var rect = element.getBoundingClientRect();
    var rectBody = doc.body.getBoundingClientRect();

    //Firebug.Console.log(element);
    //Firebug.Console.log(rect.left+' '+rect.top+' '+rect.right+' '+rect.bottom+' '+rect.width+' '+rect.height);
    //Firebug.Console.log(rectBody.left+' '+rectBody.top+' '+rectBody.right+' '+rectBody.bottom+' '+rectBody.width+' '+rectBody.height);

    //maybe something here...
    //Firebug.Console.log(element.clientLeft+' '+element.clientTop)
    //Firebug.Console.log(element.scrollLeft+' '+element.scrollTop)

    //Firebug.Console.log(doc.body)
    //Firebug.Console.log(rect)
    //Firebug.Console.log(rectBody)

    //div1.setAttribute('id', 'autoformHighlight');
    div1.setAttribute('style', 'position:absolute;z-index:2147483646'
        + ';border-width: 2px; border-color: red; border-style:solid'
        + ';left:'+(rect.left-rectBody.left-1)+'px'
        + ';top:'+(rect.top-rectBody.top+3)+'px'
        + ';width:'+rect.width+'px'
        + ';height:'+rect.height+'px'
        );
    doc.body.appendChild(div1);

    // Use all alternatives for select-multiple elements:
    if(element.type == 'select-multiple') {
      for(var i=0; i < fieldRuleAlternatives.length; i++) {
        var rule = fieldRuleAlternatives[i];
        if(rule.isOverwrite()) {
          element.options[rule.getOptionsIndex()].selected = true;
          autofillForms.action(element, 'change');
        } else {
          element.options[rule.getOptionsIndex()].selected = false;
        }
      }
      doc.body.removeChild(div1);
      return true;
    }

    // Select the alternatives index (displays a selection dialog if required):
    var index = this.selectFieldRulesAlternativesIndex(fieldRuleAlternatives);

    if(index == -1) {
      doc.body.removeChild(div1);
      return false;
    } else {
      var rule = fieldRuleAlternatives[index];
      if(element.type == 'select-one') {
        if(rule.isOverwrite()) {
          element.options[rule.getOptionsIndex()].selected = true;
          autofillForms.action(element, 'change');
        } else {
          element.options[rule.getOptionsIndex()].selected = false;
        }
      } else if(element.type == 'checkbox') {
        if(rule.isOverwrite()) {
          element.checked = true;
        } else {
          element.checked = false;
        }
      } else if(element.type == 'radio') {
        try {
          // Rules matching radio elements are stored and handled as group
          // at the end of each form loop with the applyStoredFieldRulesAlternatives method:
          if(!this.fieldRuleAlternativesHash[element.name]) {
            this.fieldRuleAlternativesHash[element.name] = new Array();
          }
          this.fieldRuleAlternativesHash[element.name].push(rule);
        } catch(e) {
          this.log(e);
          doc.body.removeChild(div1);
          return false;
        }
      } else {
        if(!element.value || rule.isOverwrite()) {
          if(element.type == 'textarea') {
            // Replace control character placeholders:
            //element.value = this.replaceControlCharacterPlaceholders(rule.getValue());
            autofillForms.action(element, 'value', this.replaceControlCharacterPlaceholders(rule.getValue()))
          } else {
            //element.value = rule.getValue();
            autofillForms.action(element, 'value', rule.getValue());
          }
        }
      }
      if(this.autofillFormsPrefs.getBoolPref('callOnChangeAfterFillingFields')) {
        this.fireEvent(element,'change')
      }
    }

    //remove the div, not needed anymore
    doc.body.removeChild(div1);
    return true;
  },

  fireEvent: function(element,anEvent) {
    var evt = document.createEvent("HTMLEvents");
    evt.initEvent(anEvent, true, true ); // event type,bubbling,cancelable
    return !element.dispatchEvent(evt);
  },

  applyStoredFieldRulesAlternatives: function() {
    for(var key in this.fieldRuleAlternativesHash) {
      var fieldRuleAlternatives = this.filterRealFieldRuleAlternatives(
        this.fieldRuleAlternativesHash[key]
      );
      var index = this.selectFieldRulesAlternativesIndex(fieldRuleAlternatives);
      if(index != -1) {
        var rule = fieldRuleAlternatives[index];
        // This is currently only used for radio input fields:
        if(rule.isOverwrite()) {
          rule.getElement().checked = true;
        } else {
          rule.getElement().checked = false;
        }
      }
    }
  },

  filterRealFieldRuleAlternatives: function(fieldRuleAlternatives) {
    // Sort the fieldRuleAlternatives by index:
    fieldRuleAlternatives.sort(this.compareFieldRuleAlternativesByIndex);
    // Make sure only real Alternatives (placed next to each other) are included:
    for(var i=1; i<fieldRuleAlternatives.length; i++) {
      // If the fieldRules index is more than one step larger than the previous one,
      // the remaining array items can be sliced off - they are no real Alternatives:
      if(fieldRuleAlternatives[i].getIndex()-1 > fieldRuleAlternatives[i-1].getIndex()) {
        fieldRuleAlternatives = fieldRuleAlternatives.slice(0, i);
        break;
      }
    }
    return fieldRuleAlternatives;
  },

  compareFieldRuleAlternativesByIndex: function(ruleA, ruleB) {
    if(ruleA.getIndex() < ruleB.getIndex()) {
      return -1;
    } else if(ruleA.getIndex() > ruleB.getIndex()) {
      return 1;
    }
    return 0;
  },

  getFieldRulesAlternativeLabel: function(rule) {
    // This method returns a label for this alternative
    // to be displayed on the alternatives selection
    switch(rule.getElement().type) {
      case 'select-multiple':
      case 'select-one':
        // Use the options text:
        return rule.getElement().options[rule.getOptionsIndex()].text;
      case 'radio':
      case 'checkbox':
        // Try to retrieve the element label:
        var label = this.getLabelForElement(rule.getElement());
        // Remove the colon, if present:
        if(label && label.charAt(label.length-1) == ':') {
          label = label.substr(0, label.length-1);
        }
        // If no label could be found,
        // use the element value:
        if(!label) {
          label = rule.getElement().value;
        }
        return label;
      default:
        // Use the calculated value:
        return rule.getValue();
    }
  },

  selectFieldRulesAlternativesIndex: function(fieldRuleAlternatives) {
    // Display a selection prompt if we have alternatives and no alternativesIndex has been set yet
    // or the rememberAlternativesIndex setting is false or the saved alternativesLength is different:
    if(fieldRuleAlternatives.length > 1) {
      // When alternatives are disabled, return either 0 (remember the alternative)
      // or cycle through the available alternatives.
      if(this.autofillFormsPrefs.getBoolPref('disableAlternatives') == true) {
        var fieldRuleAlternativesIndex = 0;
        /*
        //todo take into account multiple instances of the form field. Can't increase the index blindly...
        if(this.autofillFormsPrefs.getBoolPref('rememberAlternativesIndex') == false) {
          fieldRuleAlternativesIndex = this.fieldRuleAlternativesIndex;
          if (this.fieldRuleAlternativesIndex == fieldRuleAlternatives.length-1) {
            this.fieldRuleAlternativesIndex = 0;
          }
          else {
            this.fieldRuleAlternativesIndex += 1;
          }
        }
        */
        return fieldRuleAlternativesIndex;
      }

      if(this.autofillFormsPrefs.getBoolPref('rememberAlternativesIndex') == false
        || this.fieldRuleAlternativesIndex === null
        || fieldRuleAlternatives.length != this.fieldRuleAlternativesLength) {
        // The selection list displays the index number and the current fieldRuleValues:
        var list = new Array();
        var maxFigureLength = fieldRuleAlternatives.length.toString().length;
        for(var i=0; i < fieldRuleAlternatives.length; i++) {
          list.push(
            this.addLeadingZeros(i+1, maxFigureLength)
            + '.  '
            + this.getFieldRulesAlternativeLabel(fieldRuleAlternatives[i])
            + '  - '
            + fieldRuleAlternatives[i].getName()
          );
        }
        var selected = {};
        // Show the selection prompt:
        var ok = this.getPrompts().select(
          window,
          this.getStringBundle().getString('alternativesSelectionWindowTitle'),
          this.getStringBundle().getString('alternativesSelectionPrompt'),
          list.length,
          list,
          selected
        );
        // Save the selected alternatives index, return -1 on cancel:
        if(ok)
          this.fieldRuleAlternativesIndex = selected.value;
        else
          return -1;

        this.fieldRuleAlternativesLength = fieldRuleAlternatives.length;
      }
      // Use the fieldRuleAlternative with the selected fieldRuleAlternativesIndex:
      return this.fieldRuleAlternativesIndex;
    } else if(fieldRuleAlternatives.length == 1) {
      return 0;
    }
    return -1;
  },

  stripTags: function(str) {
    if (!arguments.callee.regExp) {
      arguments.callee.regExp = new RegExp('<\\/?[^>]+?>', 'g');
    }
    // Return string stripped from HTML tags:
    return str.replace(arguments.callee.regExp, '');
  },

  trim: function(str) {
    if (!arguments.callee.regExp) {
      arguments.callee.regExp = new RegExp('(?:^\\s+)|(?:\\s+$)', 'g');
    }
    // Return string with whitespace removed at beginning and end of the string:
    return str.replace(arguments.callee.regExp, '');
  },

  initProfilesPopupMenu: function(event) {
    var menupopup = event.target;
    // Remove all children nodes:
    while(menupopup.hasChildNodes()) {
      menupopup.removeChild(menupopup.firstChild);
    }
    // Add the profile labels as menu items:
    for(var i=0; i < this.getProfileLabels().length; i++) {
      var menuitem = document.createElement('menuitem');
      menuitem.setAttribute('label', this.getProfileLabel(i));
      menuitem.setAttribute('data-index', i);
      menuitem.addEventListener("command", function () {
        var i = +this.getAttribute('data-index');
        autofillForms.setProfileIndex(i);
      });
      menuitem.setAttribute('type', 'radio');
      if(i == this.getProfileIndex()) {
        menuitem.setAttribute('checked', true);
      }
      menupopup.appendChild(menuitem);
    }
  },

  initManualFillContextMenu: function(event) {
    var menupopup = event.target;
    // Remove all children nodes:
    while(menupopup.hasChildNodes()) {
      menupopup.removeChild(menupopup.firstChild);
    }

    var authenticationNeeded = false;
    if(this.autofillFormsPrefs.getBoolPref('storeEncrypted')) {
      // Determine if a master password is set and the user has not been authenticated yet:
      authenticationNeeded = this.getMasterSecurityDevice().getInternalKeyToken().needsLogin()
                  && !this.getMasterSecurityDevice().getInternalKeyToken().isLoggedIn();
    }

    if(this.autofillFormsPrefs.getBoolPref('useConfigDirectory')) {
      // Always retrieve the profile labels from file if useConfigDirectory is enabled:
      this.profileLabels = null;
    }

    // Check if only one profile is to be shown:
    if((this.getFormFieldsContextMenuProfileIndex() != -3) || (this.getProfileLabels().length == 1)) {
      var profileIndex = (this.getFormFieldsContextMenuProfileIndex() == -2)
        ? this.getProfileIndex() : this.getFormFieldsContextMenuProfileIndex();
      if(authenticationNeeded) {
        var menuitem = document.createElement('menuitem');
        menuitem.setAttribute('label', this.getProfileLabel(profileIndex)+'...');
        menuitem.setAttribute('data-profileIndex', profileIndex);
        menuitem.addEventListener("command", function () {
          var i = +this.getAttribute('data-profileIndex');
          autofillForms.authenticateAndShowManualFillDialog(i);
        });
        menupopup.appendChild(menuitem);
      } else {
        this.initManualFillProfileContextMenu(event, profileIndex);
      }
      return;
    }

    // Add the profile labels as menus or menuitems if authentication is needed:
    for(var i=0; i < this.getProfileLabels().length; i++) {
      if(authenticationNeeded) {
        var menuitem = document.createElement('menuitem');
        menuitem.setAttribute('label', this.getProfileLabel(i)+'...');
        menuitem.setAttribute('data-index', i);
        menuitem.addEventListener("command", function () {
          var i = +this.getAttribute('data-index');
          autofillForms.authenticateAndShowManualFillDialog(i);
        });
        menupopup.appendChild(menuitem);
      } else {
        var menu = document.createElement('menu');
        menu.setAttribute('label', this.getProfileLabel(i));

        // Add a menupopup for each profile:
        var profilemenupopup = document.createElement('menupopup');
        profilemenupopup.setAttribute('data-index', i);
        profilemenupopup.addEventListener("popupshowing", function (event) {
          if(event.target == this) {
            var i = +this.getAttribute('data-index');
            autofillForms.initManualFillProfileContextMenu(event, i);
          }
        });
        menu.appendChild(profilemenupopup);
        menupopup.appendChild(menu);
      }
    }
  },

  initManualFillProfileContextMenu: function(event, profileID) {
    var menupopup = event.target;
    // Remove all children nodes:
    while(menupopup.hasChildNodes()) {
      menupopup.removeChild(menupopup.firstChild);
    }
    var menuPopupMore;
    // Add the profile field rules as menu items:
    for(var i=0; i < this.getFieldRules(profileID).length; i++) {
      var menuitem = document.createElement('menuitem');
      menuitem.setAttribute('label', this.getFieldRules(profileID)[i]['fieldRuleName']);
      menuitem.setAttribute('data-index', i);
      menuitem.setAttribute('data-profileID', profileID);
      menuitem.addEventListener("command", function () {
        var i = +this.getAttribute('data-index');
        var profileID = +this.getAttribute('data-profileID');
        autofillForms.fillTargetFormField(profileID, i);
      });
      if(this.getFieldRules(profileID)[i]['fieldRuleEnabled']) {
        menupopup.appendChild(menuitem);
      } else {
        // Add disabled items to a "More..." menu:
        if(!menuPopupMore) {
          menuPopupMore = document.createElement('menupopup');
        }
        menuPopupMore.appendChild(menuitem);
      }
    }
    if(menuPopupMore) {
      if(!menupopup.hasChildNodes()) {
        // All field rules of this profile are disabled, so no need to create a submenu:
        while(menuPopupMore.hasChildNodes()) {
          // appendChild removes the node from the current parent node
          // and adds it to the new parent node:
          menupopup.appendChild(menuPopupMore.firstChild);
        }
      } else {
        // Append the "More..." menu:
        var menuMore = document.createElement('menu');
        menuMore.setAttribute('label', this.getStringBundle().getString('contextMenuMore'));
        menuMore.appendChild(menuPopupMore);
        menupopup.appendChild(menuMore);
      }
    }
    // Reset object to release used memory:
    this.fieldRules = null;
  },

  authenticateAndShowManualFillDialog: function(profileID) {
    try {
      Components.classes['@mozilla.org/security/pk11tokendb;1']
        .getService(Components.interfaces.nsIPK11TokenDB).getInternalKeyToken().login(false);

      var prompts = Components.classes['@mozilla.org/embedcomp/prompt-service;1']
                  .getService(Components.interfaces.nsIPromptService);
      // The selection and the subselection lists:
      var list = new Array();
      var listMore;
      // Hashs mapping the list positions to the original indices:
      var listIndexMapping = new Object();;
      var listMoreIndexMapping;
      for(var i=0; i < this.getFieldRules(profileID).length; i++) {
        if(this.getFieldRules(profileID)[i]['fieldRuleEnabled']) {
          list.push(this.getFieldRules(profileID)[i]['fieldRuleName']);
          listIndexMapping[list.length-1] = i;
        } else {
          // Add disabled items to a "More..." list:
          if(!listMore) {
            listMore = new Array();
            listMoreIndexMapping = new Object();
          }
          listMore.push(this.getFieldRules(profileID)[i]['fieldRuleName']);
          listMoreIndexMapping[listMore.length-1] = i;
        }
      }
      if(listMore) {
        // If all field rules of this profile are disabled, there is no need of a sublist:
        if(!list.length) {
          list = listMore;
          listIndexMapping = listMoreIndexMapping;
          listMore = null;
          listMoreIndexMapping = null;
        } else {
          list.push(this.getStringBundle().getString('contextMenuMore'));
        }
      }
      var selected = {};
      var ok = Components.classes['@mozilla.org/embedcomp/prompt-service;1']
            .getService(Components.interfaces.nsIPromptService)
            .select(
              window,
              null, // Window title - defaults to locale version of "Select"
              null, // Prompt text - defaults to empty string
              list.length,
              list,
              selected
            );
      if(ok) {
        // If "More..." is selected, show the disabled items as selection list:
        if(listMore && selected.value == list.length-1) {
          selected = {};
          ok = Components.classes['@mozilla.org/embedcomp/prompt-service;1']
            .getService(Components.interfaces.nsIPromptService)
            .select(
              window,
              null, // Window title - defaults to locale version of "Select"
              null, // Prompt text - defaults to empty string
              listMore.length,
              listMore,
              selected
            );
          if(ok) {
            this.fillTargetFormField(
              profileID,
              listMoreIndexMapping[selected.value]
            );
          }
        } else {
          this.fillTargetFormField(
            profileID,
            listIndexMapping[selected.value]
          );
        }
      }
    } catch(e) {
      // Authentication with master security device failed
    }
    // Reset object to release used memory:
    this.fieldRules = null;
  },

  fillTargetFormField: function(profileID, ruleID) {
    if(this.targetFormField) {
      var value = this.getFieldRules(profileID)[ruleID]['fieldRuleValue'];
      // Replace dynamic tags if enabled:
      if(this.autofillFormsPrefs.getBoolPref('enableDynamicTags')) {
        value = this.replaceDynamicTags(value);
      }
      try {
        // Try to use selection information:
        var newCursorPos = this.targetFormField.selectionStart + value.length;
/*        this.targetFormField.value =   this.targetFormField.value.substr(0, this.targetFormField.selectionStart)
                        + value
                        + this.targetFormField.value.substr(this.targetFormField.selectionEnd);
        // Adjust the cursor position:
        this.targetFormField.selectionEnd = newCursorPos;
        this.targetFormField.selectionStart = newCursorPos;
*/
        autofillForms.action(this.targetFormField, 'value',
          this.targetFormField.value.substr(0, this.targetFormField.selectionStart)
            + value
            + this.targetFormField.value.substr(this.targetFormField.selectionEnd)
        );
        autofillForms.action(this.targetFormField, 'selectionEnd', newCursorPos);
        autofillForms.action(this.targetFormField, 'selectionStart', newCursorPos);
      } catch(e) {
        // This input field does not support selections - just try to set the value:
        try {
          //this.targetFormField.value = value;
          autofillForms.action(this.targetFormField, 'value', value);
        } catch(e) {
          // Catch errors if value could not be set on the form field
        }
      }
      // Reset objects to release used memory:
      this.fieldRules = null;
      this.dynamicTags = null;
      this.dynamicTagCodes = null;
    }
  },

  tooltip: function(event) {
    if (!document.tooltipNode) {
      return;
    }
    // Get the tooltip node:
    var tooltip = document.getElementById('autofillFormsTooltip');
    if(tooltip) {
      // Add the associated tooltip content for each toolbar button menu item, toolbar button and statusbar icon:
      if(document.tooltipNode.id == 'autofillFormsButton' || document.tooltipNode.id == 'autofillFormsPanelIcon') {
        if(this.autofillFormsPrefs.getBoolPref('useConfigDirectory')) {
          // Always retrieve the profile labels from file if useConfigDirectory is enabled:
          this.profileLabels = null;
          this.tooltipCurrentProfile = null;
        }
        if(!this.tooltipCurrentProfile || !this.tooltipGrid) {
          // Remove all children nodes:
          while(tooltip.hasChildNodes()) {
            tooltip.removeChild(tooltip.firstChild);
          }
          // Add the current profile label:
          tooltip.appendChild(this.getTooltipCurrentProfile());
          // Add the tooltip grid with the command labels, mouse buttons and keyboard shortcuts:
          tooltip.appendChild(this.getTooltipGrid());
        }
      } else {
        // Don't show tooltips for the toolbar button menu items:
        event.preventDefault();
      }
    }
  },

  getTooltipCurrentProfile: function() {
    if(!this.tooltipCurrentProfile) {
      var hbox = document.createElement('hbox');
      hbox.setAttribute(
        'id',
        'autofillFormsTooltipCurrentProfile'
      );
      var label = document.createElement('label');
      label.setAttribute(
        'value',
        this.getStringBundle().getString('currentProfileLabel')
      );
      label.setAttribute(
        'id',
        'autofillFormsTooltipCurrentProfileCaption'
      );
      hbox.appendChild(label);
      label = label.cloneNode(false);
      label.setAttribute(
        'value',
        this.getProfileLabel(this.getProfileIndex())
      );
      label.setAttribute(
        'id',
        'autofillFormsTooltipCurrentProfileLabel'
      );
      hbox.appendChild(label);
      this.tooltipCurrentProfile = hbox;
    }
    return this.tooltipCurrentProfile;
  },

  getTooltipGrid: function() {
    if(!this.tooltipGrid) {
      var commands = new Array();
      for(var property in this.shortcut) {
        commands.push(new Array(
          this.getStringBundle().getString('tooltip'+property.replace(/shortcut/,'')),
          this.getFormattedMouseButton(this.getMouseButton('mouseS'+property.substr(1))),
          this.getFormattedShortcut(this.getShortcut(property))
        ));
      }
      var grid = document.createElement('grid');
      grid.setAttribute(
        'id',
        'autofillFormsTooltipGrid'
      );
      var columns = document.createElement('columns');
      var column = document.createElement('column');
      var rows = document.createElement('rows');
      var row = document.createElement('row');
      var label = document.createElement('label');
      columns.appendChild(column);
      columns.appendChild(column.cloneNode(false));
      columns.appendChild(column.cloneNode(false));
      grid.appendChild(columns);
      // Create the column headers:
      label.setAttribute(
        'class',
        'autofillFormsTooltipGridHeader'
      );
      label.setAttribute(
        'value',
        this.getStringBundle().getString('command')
      );
      row.appendChild(label);
      label = label.cloneNode(false);
      label.setAttribute(
        'value',
        this.getStringBundle().getString('mousebutton')
      );
      row.appendChild(label);
      label = label.cloneNode(false);
      label.setAttribute(
        'value',
        this.getStringBundle().getString('keyboardShortcut')
      );
      row.appendChild(label);
      rows.appendChild(row);
      // Create a row for each command:
      for(var i=0; i<commands.length; i++) {
        row = row.cloneNode(false);
        // Skip if neither mouseButton nor keyboard shortcut is set:
        if(!commands[i][1] && !commands[i][2]) {
          continue;
        }
        for(var j=0; j<commands[i].length; j++) {
          label = label.cloneNode(false);
          label.setAttribute(
            'value',
            commands[i][j]
          );
          if(j == 0) {
            label.setAttribute(
              'class',
              'autofillFormsTooltipGridCommand'
            );
          } else if(j == 1) {
            label.setAttribute(
              'class',
              'autofillFormsTooltipGridMouseButton'
            );
          } else {
            label.setAttribute(
              'class',
              'autofillFormsTooltipGridKeyboardShortcut'
            );
          }
          row.appendChild(label);
        }
        rows.appendChild(row);
      }
      grid.appendChild(rows);
      this.tooltipGrid = grid;
    }
    return this.tooltipGrid;
  },

  resetAllProfiles: function() {
    if(this.autofillFormsPrefs.getBoolPref('enableConfirmationDialogs')) {
      // Confirmation dialog:
      if(!this.getPrompts().confirm(
          null,
          this.getStringBundle().getString('resetAllProfilesTitle'),
          this.getStringBundle().getString('resetAllProfilesText')
        )
      ) {
        return;
      }
    }

    // Reset the user preferences:
    if(this.autofillFormsPrefs.prefHasUserValue('useConfigDirectory')) {
      this.autofillFormsPrefs.clearUserPref('useConfigDirectory');
    }
    if(this.autofillFormsPrefs.prefHasUserValue('storeEncrypted')) {
      this.autofillFormsPrefs.clearUserPref('storeEncrypted');
    }
    if(this.autofillFormsPrefs.prefHasUserValue('profileIndex')) {
      this.autofillFormsPrefs.clearUserPref('profileIndex');
    }
    if(this.autofillFormsPrefs.prefHasUserValue('profileLabels')) {
      this.autofillFormsPrefs.clearUserPref('profileLabels');
    }
    if(this.autofillFormsPrefs.prefHasUserValue('profileSiteRules')) {
      this.autofillFormsPrefs.clearUserPref('profileSiteRules');
    }
    if(this.autofillFormsPrefs.prefHasUserValue('fieldRules')) {
      this.autofillFormsPrefs.clearUserPref('fieldRules');
    }

    this.profileIndex = null;
    this.profileLabels = null;
    this.profileSiteRules = null;
    this.fieldRules = null;

    // Re-init the profiles lists:
    this.initProfilesLists();
    // Re-init the fieldRules tree:
    this.initTree();
    // Re-initialize the simple interface:
    this.initSimpleInterface();

    if(this.tree && this.selection) {
      try {
        // Clear out the fieldRules tree selections
        this.selection.select(-1);
      } catch(e) {
        this.log(e);
      }
    }
  },

  initProfilesLists: function(event) {
    // The profiles tree:
    this.initProfilesTree();

    // Editable profiles menu list:
    var profilesMenuList = document.getElementById('profilesMenuList');
    if(profilesMenuList) {
      profilesMenuList.removeAllItems();
      for(var i=0; i < this.getProfileLabels().length; i++) {
        profilesMenuList.appendItem(
          this.getProfileLabel(i)
        );
      }
      profilesMenuList.selectedIndex = this.getProfileIndex();
    }
    // Simple interface profiles menu list:
    var simpleInterfaceProfileMenuList = document.getElementById('simpleInterfaceProfileMenuList');
    if(simpleInterfaceProfileMenuList) {
      simpleInterfaceProfileMenuList.removeAllItems();
      for(var i=0; i < this.getProfileLabels().length; i++) {
        simpleInterfaceProfileMenuList.appendItem(
          this.getProfileLabel(i)
        );
      }
      simpleInterfaceProfileMenuList.selectedIndex = this.getProfileIndex();
    }
    // Global profile selection:
    var globalProfileMenuList = document.getElementById('globalProfileMenuList');
    if(globalProfileMenuList) {
      globalProfileMenuList.removeAllItems();
      for(var i=0; i < this.getProfileLabels().length; i++) {
        globalProfileMenuList.appendItem(
          this.getProfileLabel(i)
        );
      }
      globalProfileMenuList.selectedIndex = this.getGlobalProfileIndex();
    }
    // Form fields context menu selection:
    var contextMenuProfileMenuList = document.getElementById('contextMenuProfileMenuList');
    if(contextMenuProfileMenuList) {
      // The first 3 items are "All profiles", "Active profile" and a menuseparator:
      while(contextMenuProfileMenuList.firstChild.childNodes[3]) {
        // The more convenient getItemAtIndex does not seem to work with Firefox versions < 3,
        // so we use DOM methods on the menupopup child node of the menu node instead:
        contextMenuProfileMenuList.firstChild.removeChild(
          contextMenuProfileMenuList.firstChild.childNodes[3]
        );
      }
      for(var i=0; i < this.getProfileLabels().length; i++) {
        contextMenuProfileMenuList.appendItem(
          this.getProfileLabel(i)
        );
      }
      contextMenuProfileMenuList.selectedIndex
        = this.getFormFieldsContextMenuProfileIndex()+3;
    }

    // The profile site rule textbox:
    this.initProfileSiteRuleTextBox();
  },

  updateProfilesLists: function() {
    // The more convenient getItemAtIndex does not seem to work with Firefox versions < 3,
    // so we use DOM methods on the menupopup child node of the menu nodes instead:

    // Editable profiles menu list:
    var profilesMenuList = document.getElementById('profilesMenuList');
    if(profilesMenuList) {
      profilesMenuList
        .firstChild.childNodes[this.getProfileIndex()].label
        = this.getProfileLabel(this.getProfileIndex());
    }
    // Simple interface profiles menu list:
    var simpleInterfaceProfileMenuList = document.getElementById('simpleInterfaceProfileMenuList');
    if(simpleInterfaceProfileMenuList) {
      simpleInterfaceProfileMenuList
        .firstChild.childNodes[this.getProfileIndex()].label
        = this.getProfileLabel(this.getProfileIndex());
    }
    // Global profile selection:
    var globalProfileMenuList = document.getElementById('globalProfileMenuList');
    if(globalProfileMenuList) {
      globalProfileMenuList
        .firstChild.childNodes[this.getProfileIndex()].label
        = this.getProfileLabel(this.getProfileIndex());
    }
    // Form fields context menu selection:
    var contextMenuProfileMenuList = document.getElementById('contextMenuProfileMenuList');
    if(contextMenuProfileMenuList) {
      // The first 3 items are "All profiles", "Active profile" and a menuseparator:
      contextMenuProfileMenuList
        .firstChild.childNodes[this.getProfileIndex()+3].label
        = this.getProfileLabel(this.getProfileIndex());
    }
    // The profiles tree:
    if(this.profilesTreeBox) {
      this.profilesTreeBox.invalidateRow(this.getProfileIndex());
    }
  },

  getProfileIndex: function() {
    if(this.profileIndex == null)
      this.profileIndex = this.autofillFormsPrefs.getIntPref('profileIndex');
    return this.profileIndex;
  },

  setProfileIndex: function(index) {
    if(this.profileIndex == index)
      return;

    // See method selectedFieldRule() why this has to be set to null:
    this.lastSelectedIndex = null;

    this.autofillFormsPrefs.setIntPref('profileIndex',parseInt(index));
    // Update the tree view if present:
    if(this.tree) {
      // The settings page doesn't observe preferences changes - set the profileIndex manually:
      this.profileIndex = index;
      // Re-init the tree:
      this.initTree();
      // Re-initialize the simple interface:
      this.initSimpleInterface();
    }
    // Update the profiles tree selection if present and not already updated:
    if(this.profilesTree && this.profilesSelection.currentIndex != index) {
      // Select the current profile:
      this.profilesSelection.select(index);

      // Ensure row is visible (scrolls if not):
      this.profilesTreeBox.ensureRowIsVisible(index);
    }
    // Editable profiles menu list:
    var profilesMenuList = document.getElementById('profilesMenuList');
    if(profilesMenuList) {
      profilesMenuList.selectedIndex = this.getProfileIndex();
    }
    // Simple interface profiles menu list:
    var simpleInterfaceProfileMenuList = document.getElementById('simpleInterfaceProfileMenuList');
    if(simpleInterfaceProfileMenuList) {
      simpleInterfaceProfileMenuList.selectedIndex = this.getProfileIndex();
    }

    // The profile site rule textbox:
    this.initProfileSiteRuleTextBox();
  },

  getGlobalProfileIndex: function() {
    if(this.globalProfileIndex == null) {
      this.globalProfileIndex = this.autofillFormsPrefs.getIntPref('globalProfileIndex');
    }
    return this.globalProfileIndex;
  },

  setGlobalProfileIndex: function(index) {
    if(this.globalProfileIndex == index) {
      return;
    }
    this.autofillFormsPrefs.setIntPref('globalProfileIndex',parseInt(index));
    // The settings page doesn't observe preferences changes - set the profileIndex manually:
    this.globalProfileIndex = index;
  },

  getFormFieldsContextMenuProfileIndex: function() {
    if(this.formFieldsContextMenuProfileIndex == null) {
      this.formFieldsContextMenuProfileIndex
        = this.autofillFormsPrefs.getIntPref('formFieldsContextMenuProfileIndex');
    }
    return this.formFieldsContextMenuProfileIndex;
  },

  setFormFieldsContextMenuProfileIndex: function(index) {
    if(this.formFieldsContextMenuProfileIndex == index) {
      return;
    }
    this.autofillFormsPrefs.setIntPref('formFieldsContextMenuProfileIndex',parseInt(index));
    // The settings page doesn't observe preferences changes - set the profileIndex manually:
    this.formFieldsContextMenuProfileIndex = index;
  },

  getProfileLabelsFile: function() {
    var file = this.getConfigDirectory();
    file.append('profileLabels.txt');
    if(!file.exists()) {
      file.create(Components.interfaces.nsIFile.NORMAL_FILE_TYPE, 0660);
    }
    return file;
  },

  exportProfileLabelsToConfigDirectory: function() {
    var prefString;
    // Get the profileLabels string from the preferences:
    prefString = this.autofillFormsPrefs
              .getComplexValue('profileLabels',Components.interfaces.nsIPrefLocalizedString)
              .data;
    if(prefString) {
      this.setFileContent(this.getProfileLabelsFile(), prefString);
    }
  },

  importProfileLabelsFromConfigDirectory: function() {
    var prefString;
    prefString = this.getFileContent(this.getProfileLabelsFile());
    if(prefString) {
      // Store the profileLabels as unicode string in the preferences:
      this.autofillFormsPrefs.setComplexValue(
        'profileLabels',
        Components.interfaces.nsISupportsString,
        this.getUnicodeString(prefString)
      );
    }
  },

  getProfileLabels: function() {
    if(this.profileLabels == null) {
      var prefString;
      if(this.autofillFormsPrefs.getBoolPref('useConfigDirectory')) {
        // Get the profileLabels string from the profileLabels file in the configDirectory:
        prefString = this.getFileContent(this.getProfileLabelsFile());
      }
      if(!prefString) {
        prefString = this.autofillFormsPrefs
                .getComplexValue('profileLabels',Components.interfaces.nsIPrefLocalizedString)
                .data;
      }
      // The profile labels are stored as a string with tabs as separators:
      this.profileLabels = prefString.split('\t');
    }
    return this.profileLabels;
  },

  setProfileLabels: function(profileLabels) {
    // Save the profile labels separated by tabs:
    var prefString = profileLabels.join('\t');
    if(this.autofillFormsPrefs.getBoolPref('useConfigDirectory')) {
      this.setFileContent(this.getProfileLabelsFile(), prefString);
    } else {
      this.autofillFormsPrefs.setComplexValue(
        'profileLabels',
        Components.interfaces.nsISupportsString,
        this.getUnicodeString(prefString)
      );
    }
  },

  getProfileLabel: function(index) {
    while(this.getProfileLabels().length <= index) {
      this.getProfileLabels().push(this.getUniqueProfileLabel());
    }
    return this.getProfileLabels()[index];
  },

  setProfileLabel: function(index, label) {
    while(this.getProfileLabels().length <= index) {
      this.getProfileLabels().push(this.getUniqueProfileLabel());
    }
    this.getProfileLabels()[index] = label;
    // Save the profileLabels list in the preferences:
    this.setProfileLabels(this.getProfileLabels());
  },

  getUniqueProfileLabel: function(profileLabel) {
    if(!profileLabel) {
      profileLabel = 'Profile';
    }

    // Make sure the profile label is unique:
    if(!this.inArray(this.getProfileLabels(), profileLabel)) {
      return profileLabel;
    }
    var i = profileLabel.lastIndexOf(' ');
    var n = parseInt(profileLabel.substr(i+2));
    if(isNaN(n)) {
      return this.getUniqueProfileLabel(profileLabel+' (2)');
    }
    n++;
    profileLabel = profileLabel.substr(0, i)+' ('+n+')';
    return this.getUniqueProfileLabel(profileLabel);
  },

  changeProfileLabel: function(newProfileLabel) {
    var profilesMenuList = document.getElementById('profilesMenuList');
    if(profilesMenuList) {
      // Make sure the new profile label is safe and unique:
      newProfileLabel = this.getUniqueProfileLabel(this.makeSafe(newProfileLabel));
      // Update the label of the selected profile:
      this.setProfileLabel(this.getProfileIndex(), newProfileLabel);
      // Update the profiles textbox contents:
      profilesMenuList.inputField.value = newProfileLabel;
      document.getElementById('profileLabelTextBox').value = newProfileLabel;
      // Update the profiles lists:
      this.updateProfilesLists();
    }
  },

  initProfileSiteRuleTextBox: function(event) {
    var profileSiteRuleTextBox = document.getElementById('profileSiteRuleTextBox');
    if(profileSiteRuleTextBox) {
      profileSiteRuleTextBox.value = this.getProfileSiteRule(this.getProfileIndex());
    }
  },

  changeProfileSiteRule: function(siteRule) {
    var profileSiteRuleTextBox = document.getElementById('profileSiteRuleTextBox');
    if(profileSiteRuleTextBox) {
      // Check the regular expression before updating the profile site rules:
      try {
        siteRule = this.getRegExpStr(
          this.makeSafe(siteRule)
        );
        profileSiteRuleTextBox.value = siteRule;
        document.getElementById('profileSiteRuleTextBox2').value = siteRule;

        var newProfileSiteRules = this.getProfileSiteRules();
        newProfileSiteRules[this.getProfileIndex()] = siteRule;
        this.setProfileSiteRules(newProfileSiteRules);

        // Update the profiles tree:
        if(this.profilesTreeBox) {
          this.profilesTreeBox.invalidateRow(this.getProfileIndex());
        }
      } catch(e) {
        this.invalidRegExpAlert(e);
      }
    }
  },

  getProfileSiteRulesFile: function() {
    var file = this.getConfigDirectory();
    file.append('profileSiteRules.txt');
    if(!file.exists()) {
      file.create(Components.interfaces.nsIFile.NORMAL_FILE_TYPE, 0660);
    }
    return file;
  },

  exportProfileSiteRulesToConfigDirectory: function() {
    var prefString;
    // Get the profileSiteRules string from the preferences:
    prefString = this.autofillFormsPrefs
              .getComplexValue('profileSiteRules',Components.interfaces.nsISupportsString)
              .data;
    if(prefString) {
      this.setFileContent(this.getProfileSiteRulesFile(), prefString);
    }
  },

  importProfileSiteRulesFromConfigDirectory: function() {
    var prefString;
    prefString = this.getFileContent(this.getProfileSiteRulesFile());
    if(prefString) {
      // Store the profileSiteRules as unicode string in the preferences:
      this.autofillFormsPrefs.setComplexValue(
        'profileSiteRules',
        Components.interfaces.nsISupportsString,
        this.getUnicodeString(prefString)
      );
    }
  },

  getProfileSiteRules: function() {
    if(this.profileSiteRules == null) {
      var prefString;
      if(this.autofillFormsPrefs.getBoolPref('useConfigDirectory')) {
        // Get the profileSiteRules string from the profileSiteRules file in the configDirectory:
        prefString = this.getFileContent(this.getProfileSiteRulesFile());
      }
      if(!prefString) {
        prefString = this.autofillFormsPrefs
                .getComplexValue('profileSiteRules',Components.interfaces.nsISupportsString)
                .data;
      }
      // The profile SiteRules are stored as a string with tabs as separators:
      this.profileSiteRules = prefString.split('\t');
    }
    return this.profileSiteRules;
  },

  setProfileSiteRules: function(profileSiteRules) {
    // Save the profile SiteRules separated by tabs:
    var prefString = profileSiteRules.join('\t');
    if(this.autofillFormsPrefs.getBoolPref('useConfigDirectory')) {
      this.setFileContent(this.getProfileSiteRulesFile(), prefString);
    } else {
      this.autofillFormsPrefs.setComplexValue(
        'profileSiteRules',
        Components.interfaces.nsISupportsString,
        this.getUnicodeString(prefString)
      );
    }
  },

  getProfileSiteRule: function(index) {
    while(this.getProfileSiteRules().length <= index) {
      this.getProfileSiteRules().push('(?:)');
    }
    return this.getProfileSiteRules()[index];
  },

  setProfileSiteRule: function(index, siteRule) {
    while(this.getProfileSiteRules().length <= index) {
      this.getProfileSiteRules().push('(?:)');
    }
    this.getProfileSiteRules()[index] = siteRule;
    // Save the profileSiteRules in the preferences:
    this.setProfileSiteRules(this.getProfileSiteRules());
  },

  addFormAsProfile: function(event) {
    if(this.targetFormField && this.targetFormField.form) {
      var elements = this.targetFormField.form.elements;
      var doc = this.targetFormField.form.ownerDocument;

      var newProfile = new Array();

      // Go through the form elements:
      for(var i=0; i<elements.length; i++) {
        // Only use valid form fields:
        if(this.isValidFormField(elements[i])) {
          var value;
          var overwrite = true;

          // Create the fieldRule (from name, label or id):
          var fieldRule = this.getFieldRuleForElement(elements[i]);

          switch(elements[i].type) {
            case 'checkbox':
              // Add a rule to uncheck the checkbox if it is unchecked:
              if(!elements[i].checked) {
                overwrite = false;
              }
              value = this.getRegExpStrForValue(elements[i].value);
              break;
            case 'radio':
              // Only add checked radio buttons:
              if(!elements[i].checked) {
                continue;
              }
              value = this.getRegExpStrForValue(elements[i].value);
              break;
            case 'select-one':
              value = this.getRegExpStrForValue(elements[i].value);
              break;
            case 'select-multiple':
              var fieldRuleLabel = this.makeSafe(this.getFieldRuleNameForElement(elements[i]));
              // Add all options as fieldRules, set "overwrite" to true if selected:
              for(var j = 0; j < elements[i].options.length; j++) {
                newProfile.push(
                  this.createFieldRule(
                    fieldRuleLabel+' ('+j+')',
                    this.getRegExpStrForValue(elements[i].options[j].value),
                    fieldRule,
                    '(?:)',
                    elements[i].options[j].selected,
                    true
                  )
                );
              }
              continue;
            default:
              value = this.makeSafe(this.replaceControlCharacters(elements[i].value));
              break;
          }

          // Add the current element as new rule to the profile list:
          newProfile.push(
            this.createFieldRule(
              this.makeSafe(this.getFieldRuleNameForElement(elements[i])),
              value,
              fieldRule,
              '(?:)',
              overwrite,
              true
            )
          );
        }
      }

      // Initialize the fieldRules:
      this.getFieldRules();

      // Add the new profile to the fieldRules:
      this.fieldRules.push(newProfile);
      // Save the profiles in the preferences:
      this.setFieldRules();

      // Add a label for default empty profile:
      if(this.getProfileLabels().length == 0) {
        this.getProfileLabels().push(this.getUniqueProfileLabel());
      }
      // Use the documents hostname as profile label and add it to the profile labels list:
      this.getProfileLabels().push(this.getUniqueProfileLabel(this.makeSafe(doc.location.host)));
      // Save the profileLabels list in the preferences:
      this.setProfileLabels(this.getProfileLabels());

      // Use the protocol and domain of the web form as profile siteRule:
      this.getProfileSiteRules().push(this.getSiteRuleForURL(doc.location.protocol+'//'+doc.location.host));
      // Save the profileSiteRules in the preferences:
      this.setProfileSiteRules(this.getProfileSiteRules());

      // Save the the new profile index as selected profileIndex:
      this.setProfileIndex(this.getProfileLabels().length-1);

      // Reset the target form field:
      this.targetFormField = null;

      // Create parameters for the settings page:
      var params = new Object();
      params.newProfileFromForm = true;

      // Open up the settings page:
      this.showDialog('chrome://autofillForms/content/autofillFormsOptions.xul', params);
    }
  },

  addProfile: function(newProfileLabel) {
    // Duplicate the selected profile (do a deep copy):
    this.fieldRules.push(
      this.copyFieldRules(this.getFieldRules())
    );
    // Save the profiles in the preferences:
    this.setFieldRules();
    // Add profile label for default empty profile:
    if(this.getProfileLabels().length == 0) {
      this.getProfileLabels().push(this.getUniqueProfileLabel());
    }
    // Add the (unique) newProfileLabel to the profileLabels list:
    this.getProfileLabels().push(this.getUniqueProfileLabel(this.makeSafe(newProfileLabel)));
    // Save the profileLabels list in the preferences:
    this.setProfileLabels(this.getProfileLabels());
    // Add a new empty profileSiteRule:
    this.getProfileSiteRules().push('(?:)');
    // Save the profileSiteRules in the preferences:
    this.setProfileSiteRules(this.getProfileSiteRules());
    // Save the the new profile index as selected profileIndex:
    this.setProfileIndex(this.getProfileLabels().length-1);
    // Update the profiles lists:
    this.initProfilesLists();
    // Re-init the fieldRules tree:
    this.initTree();
    // Re-initialize the simple interface:
    this.initSimpleInterface();
  },

  removeProfile: function(event) {
    if(this.autofillFormsPrefs.getBoolPref('enableConfirmationDialogs')) {
      // Confirmation dialog:
      if(!this.getPrompts().confirm(
          null,
          this.getStringBundle().getString('removeProfileTitle'),
          this.getStringBundle().getString('removeProfileText')
        )
      ) {
        return;
      }
    }

    // Remove the selected profile from the list:
    this.fieldRules.splice(this.getProfileIndex(),1);
    // Save the profiles in the preferences:
    this.setFieldRules();
    // Remove the selected profile from the profileLabels list:
    this.getProfileLabels().splice(this.getProfileIndex(),1);
    // Save the profileLabels list in the preferences:
    this.setProfileLabels(this.getProfileLabels());
    // Remove the selected profile's siteRule:
    this.getProfileSiteRules().splice(this.getProfileIndex(),1);
    // Save the profileSiteRules in the preferences:
    this.setProfileSiteRules(this.getProfileSiteRules());
    // Adjust the profileIndex if the last profile on the list has been deleted:
    if(this.getProfileIndex()+1 > this.fieldRules.length) {
      var newIndex = this.fieldRules.length>0 ? this.fieldRules.length-1 : 0;
      this.setProfileIndex(newIndex);
    }
    // Update the profiles lists:
    this.initProfilesLists();
    // Re-init the tree:
    this.initTree();
    // Re-initialize the simple interface:
    this.initSimpleInterface();
  },

  createFieldRule: function(name,value,fieldRule,siteRule,overwrite,enabled) {
    var rule = new Object();
    rule['fieldRuleName'] = name;
    rule['fieldRuleValue'] = value;
    rule['fieldRuleFieldRule'] = fieldRule;
    rule['fieldRuleSiteRule'] = siteRule;
    rule['fieldRuleOverwrite'] = overwrite;
    rule['fieldRuleEnabled'] = enabled;
    return rule;
  },

  getRegExpPasswordLabel: function() {
    if(!arguments.callee.regExpPass) {
      arguments.callee.regExpPass = new RegExp(
                this.autofillFormsPrefs
                .getComplexValue('regExpPasswordLabel',Components.interfaces.nsIPrefLocalizedString)
                .data,
                'i');
    }
    return arguments.callee.regExpPass;
  },

  initTree: function() {
    // Get the tree:
    this.tree = document.getElementById('fieldRulesTree');

    if(this.tree) {

      // Implement the TreeView interface:
      this.treeView = {
        rowCount: 0,
        setTree: function(tree){},
        getImageSrc: function(row,column) {},
        getProgressMode: function(row,column) {},
        getCellValue: function(row,column) {
          var rowObj = this.parent.getFieldRules()[row];
          if(rowObj) {
            return rowObj[column.id];
          }
        },
        getCellText: function(row,column){
          var rowObj = this.parent.getFieldRules()[row];
          if(rowObj) {
            if(column.id=='fieldRuleValue' &&
              this.parent.getRegExpPasswordLabel().test(rowObj['fieldRuleName'])) {
              // Show passwords as asterisks:
              return rowObj[column.id].replace(/./g, '*');
            } else {
              return rowObj[column.id];
            }
          }
          return '';
        },
        isEditable: function(row,column){
          // Only checkbox columns are editable:
          if(column.id=='fieldRuleOverwrite' || column.id=='fieldRuleEnabled')
            return true;
          else
            return false;
        },
        setCellValue: function(row,column,value){
          var rowObj = this.parent.getFieldRules()[row];
          if(rowObj) {
            rowObj[column.id] = value;
            // Notify the tree:
            this.parent.treeBox.invalidateRow(row);
            // Update the preferences:
            this.parent.setFieldRules();
            // Update the simple interface (add/remove enabled/disabled rules):
            if(column.id=='fieldRuleEnabled') {
              if(value == 'true') {
                this.parent.addSimpleInterfaceRow(row);
              } else {
                this.parent.removeSimpleInterfaceRow(row);
              }
            }
          }
        },
        isSeparator: function(index) {return false;},
        isSorted: function() {return false;},
        isContainer: function(index) {return false;},
        cycleHeader: function(column) {},
        getRowProperties: function(row,prop){},
        getColumnProperties: function(column,prop){},
        getCellProperties: function(row,column,prop){},
        getParentIndex: function(index) {return -1}
      };
      // Set the autofillForms object as parent:
      this.treeView.parent = this;

      // Set the tree length using the fieldRules list length:
      this.treeView.rowCount = this.getFieldRules().length;

      // Assign the treeview:
      this.tree.view = this.treeView;

      // The TreeSelection object:
      this.selection = this.tree.view.selection;

      // The TreeBox object:
      this.treeBox = this.tree.treeBoxObject;
    }
  },

  sortFieldRules: function(event) {
    // See method selectedFieldRule() why this has to be set to null:
    this.lastSelectedIndex = null;

    if(this.autofillFormsPrefs.getBoolPref('enableConfirmationDialogs')) {
      // Confirmation dialog:
      if(!this.getPrompts().confirm(
          null,
          this.getStringBundle().getString('sortFieldRulesTitle'),
          this.getStringBundle().getString('sortFieldRulesText')
        )
      ) {
        return;
      }
    }

    // Get the id of the column:
    var id = event.target.id;

    // Helper function to sort the fieldRules objects:
    function customSort(a,b) {
      // This enables comparison of boolean true and false:
      var x = a[id].toString();
      var y = b[id].toString();

      if(x > y) return 1;
      if(x < y) return -1;
      return 0;
    }

    // Sort the form field rules using the helper function:
    this.getFieldRules().sort(customSort);

    // Change sort direction for next click:
    if(this.ascending) {
      this.ascending = false;
    } else {
      this.getFieldRules().reverse();
      this.ascending = true;
    }

    // Notify the tree:
    this.treeBox.invalidate();

    // Clear out selections
    this.selection.select(-1);

    // Update the preferences:
    this.setFieldRules();

    // Re-initialize the simple interface:
    this.initSimpleInterface();
  },

  selectedFieldRule: function(event) {
    if(this.selection.currentIndex == -1) {
      // Disable buttons:
      document.getElementById('buttonRemoveFieldRule').setAttribute('disabled', 'true');
      document.getElementById('buttonMoveUpFieldRule').setAttribute('disabled', 'true');
      document.getElementById('buttonMoveDownFieldRule').setAttribute('disabled', 'true');

      this.lastSelectedIndex = null;
    } else if(this.selection.count == 1) {
      // The onchange event (as well as onblur, etc.) of the textboxes seems to be ignored if a new item is selected,
      // so we try and apply the field rules of the last element (if changed):
      if(this.lastSelectedIndex !== null) {
        this.applyFieldRuleOnIndex(this.lastSelectedIndex);
      }

      // Update the textboxes with the selected fieldRule:
      var index = this.selection.currentIndex;
      document.getElementById('fieldRuleNameTextBox').value = this.getFieldRules()[index]['fieldRuleName'];
      document.getElementById('fieldRuleValueTextBox').value = this.getFieldRules()[index]['fieldRuleValue'];
      document.getElementById('fieldRuleFieldRuleTextBox').value = this.getFieldRules()[index]['fieldRuleFieldRule'];
      document.getElementById('fieldRuleSiteRuleTextBox').value = this.getFieldRules()[index]['fieldRuleSiteRule'];

      // Enable/Disable buttons:
      document.getElementById('buttonRemoveFieldRule').setAttribute('disabled', 'false');
      document.getElementById('buttonMoveUpFieldRule').setAttribute(
        'disabled',
        (index == 0)
      );
      document.getElementById('buttonMoveDownFieldRule').setAttribute(
        'disabled',
        (index == this.getFieldRules().length-1)
      );

      // Save the last selected index and reset it to null for any other action than just a single selection:
      this.lastSelectedIndex = index;
    } else if(this.selection.count > 1) {
      // Enable/Disable buttons:
      document.getElementById('buttonRemoveFieldRule').setAttribute('disabled', 'false');
      document.getElementById('buttonMoveUpFieldRule').setAttribute('disabled', 'true');
      document.getElementById('buttonMoveDownFieldRule').setAttribute('disabled', 'true');

      this.lastSelectedIndex = null;
    }
  },

  initProfilesTree: function() {
    this.profilesTree = document.getElementById('profilesTree');
    if(this.profilesTree) {

      // Implement the profiles TreeView interface:
      this.profilesTreeView = {
        rowCount: 0,
        setTree: function(tree){},
        getImageSrc: function(row,column) {},
        getProgressMode: function(row,column) {},
        getCellValue: function(row,column) {
          if(column.id=='profilesTreeColName') {
            return this.parent.getProfileLabel(row);
          } else {
            return this.parent.getProfileSiteRule(row);
          }
        },
        getCellText: function(row,column){
          if(column.id=='profilesTreeColName') {
            return this.parent.getProfileLabel(row);
          } else {
            return this.parent.getProfileSiteRule(row);
          }
        },
        isEditable: function(row,column){return false;},
        setCellValue: function(row,column,value){},
        isSeparator: function(index) {return false;},
        isSorted: function() {return false;},
        isContainer: function(index) {return false;},
        cycleHeader: function(column) {},
        getRowProperties: function(row,prop){},
        getColumnProperties: function(column,prop){},
        getCellProperties: function(row,column,prop){},
        getParentIndex: function(index) {return -1}
      };
      // Set the autofillForms object as parent:
      this.profilesTreeView.parent = this;

      // Seems like we need to reset these arrays to have a consistens UI:
      this.profileLabels = null;
      this.profileSiteRules = null;

      // Set the tree length using the profiles labels list length:
      this.profilesTreeView.rowCount = this.getProfileLabels().length;

      // Assign the treeview:
      this.profilesTree.view = this.profilesTreeView;

      // The TreeSelection object:
      this.profilesSelection = this.profilesTree.view.selection;

      // The TreeBox object:
      this.profilesTreeBox = this.profilesTree.treeBoxObject;

      // Select the current profile:
      this.profilesSelection.select(this.getProfileIndex());

      // Ensure row is visible (scrolls if not):
      this.profilesTreeBox.ensureRowIsVisible(this.getProfileIndex());
    }
  },

  selectedProfile: function(event) {
    var index = this.profilesSelection.currentIndex;
    if(index != -1) {
      this.setProfileIndex(index);

      if(index > 0) {
        document.getElementById('buttonMoveUpProfile').disabled = false;
      } else {
        document.getElementById('buttonMoveUpProfile').disabled = true;
      }
      if(index+1 < this.getProfileLabels().length) {
        document.getElementById('buttonMoveDownProfile').disabled = false;
      } else {
        document.getElementById('buttonMoveDownProfile').disabled = true;
      }

      if(document.getElementById('profileLabelTextBox')) {
        document.getElementById('profileLabelTextBox').value = this.getProfileLabel(this.getProfileIndex());
      }
      if(document.getElementById('profileSiteRuleTextBox2')) {
        document.getElementById('profileSiteRuleTextBox2').value = this.getProfileSiteRule(this.getProfileIndex());
      }
    } else {
      document.getElementById('buttonMoveUpProfile').disabled = true;
      document.getElementById('buttonMoveDownProfile').disabled = true;
    }
  },

  moveUpProfile: function(event) {
    var tmpProfile = this.getFieldRules(this.getProfileIndex()-1);
    this.fieldRules[this.getProfileIndex()-1] = this.getFieldRules(this.getProfileIndex());
    this.fieldRules[this.getProfileIndex()] = tmpProfile;
    this.setFieldRules();

    var tmpProfileLabel = this.getProfileLabel(this.getProfileIndex()-1);
    this.getProfileLabels()[this.getProfileIndex()-1] = this.getProfileLabel(this.getProfileIndex());
    this.getProfileLabels()[this.getProfileIndex()] = tmpProfileLabel;
    this.setProfileLabels(this.getProfileLabels());

    var tmpProfileSiteRule = this.getProfileSiteRule(this.getProfileIndex()-1);
    this.getProfileSiteRules()[this.getProfileIndex()-1] = this.getProfileSiteRule(this.getProfileIndex());
    this.getProfileSiteRules()[this.getProfileIndex()] = tmpProfileSiteRule;
    this.setProfileSiteRules(this.getProfileSiteRules());

    this.setProfileIndex(this.getProfileIndex()-1);

    this.initProfilesLists();
  },

  moveDownProfile: function(event) {
    var tmpProfile = this.getFieldRules(this.getProfileIndex()+1);
    this.fieldRules[this.getProfileIndex()+1] = this.getFieldRules(this.getProfileIndex());
    this.fieldRules[this.getProfileIndex()] = tmpProfile;
    this.setFieldRules();

    var tmpProfileLabel = this.getProfileLabel(this.getProfileIndex()+1);
    this.getProfileLabels()[this.getProfileIndex()+1] = this.getProfileLabel(this.getProfileIndex());
    this.getProfileLabels()[this.getProfileIndex()] = tmpProfileLabel;
    this.setProfileLabels(this.getProfileLabels());

    var tmpProfileSiteRule = this.getProfileSiteRule(this.getProfileIndex()+1);
    this.getProfileSiteRules()[this.getProfileIndex()+1] = this.getProfileSiteRule(this.getProfileIndex());
    this.getProfileSiteRules()[this.getProfileIndex()] = tmpProfileSiteRule;
    this.setProfileSiteRules(this.getProfileSiteRules());

    this.setProfileIndex(this.getProfileIndex()+1);

    this.initProfilesLists();
  },

  sortProfiles: function(event) {
    var newSelectedIndex = this.getProfileIndex();
    var fieldArray = this.getFieldsArray();
    var oldIndex;

    switch(event.target.id) {
      case 'profilesTreeColName':
        //Sort by Profile Label
        fieldArray.sort(function (a, b) {
          if (a[1] == b[1]) {
            return 0;
          }
          if (a[1] < b[1]) {
            return -1;
          }
          return 1;
        });
        if (!this.profilesAscending) {
          fieldArray.reverse();
        }
        for(var i=0; i<this.getProfileLabels().length; i++) {
          oldIndex = fieldArray[i][0];
          if(oldIndex == this.getProfileIndex()) {
            newSelectedIndex = i;
          }
          this.getProfileLabels()[i] = fieldArray[i][1];
          this.getProfileSiteRules()[i] = fieldArray[i][2];
          this.fieldRules[i] = fieldArray[i][3];
        }
        break;

      case 'profilesTreeColSiteRule':
        //Sort by Profile Site Rule
        fieldArray.sort(function (a, b) {
          if (a[2] == b[2]) {
            return 0;
          }
          if (a[2] < b[2]) {
            return -1;
          }
          return 1;
        });
        if (!this.profilesAscending) {
          fieldArray.reverse();
        }
        for(var i=0; i<this.getProfileLabels().length; i++) {
          oldIndex = fieldArray[i][0];
          if(oldIndex == this.getProfileIndex()) {
            newSelectedIndex = i;
          }
          this.getProfileLabels()[i] = fieldArray[i][1];
          this.getProfileSiteRules()[i] = fieldArray[i][2];
          this.fieldRules[i] = fieldArray[i][3];
        }
        break;
    }
    // Change sort direction for next click:
    this.profilesAscending = !this.profilesAscending;

    this.setFieldRules();
    this.setProfileLabels(this.getProfileLabels());
    this.setProfileSiteRules(this.getProfileSiteRules());

    this.setProfileIndex(newSelectedIndex);

    this.initProfilesLists();
  },
  getFieldsArray: function() {
    // This creates an array of [i, ProfileLabel, ProfileSiteRule, fieldRules] rows
    // we can then sort by rows[1] or rows[2] and store the row elements back in
    // their respective arrays.
    var row;
    var fieldArray = new Array();
    var tmpProfileLabels = this.getProfileLabels().slice(0);
    var tmpProfileSiteRules = this.getProfileSiteRules().slice(0);

    for(var i=0; i<this.getProfileSiteRules().length; i++) {
      row = new Array();
      row.push(i);
      row.push(tmpProfileLabels[i]);
      row.push(tmpProfileSiteRules[i]);
      row.push(this.getFieldRules(i));
      fieldArray.push(row);
    }
    return fieldArray;
  },
  profilesTreeHandleKeyPress: function(event) {
    if(event.keyCode == 46) {
      this.removeProfile();
    }
  },

  invalidRegExpAlert: function(error) {
    // Invalid regular expression alert:
    this.getPrompts().alert(
      null,
      this.getStringBundle().getString('invalidRegExpTitle'),
      this.getStringBundle().getString('invalidRegExpText') + "\n\n" + error
    );
  },

  makeSafe: function(str) {
    // Remove all tabs and linefeeds from the given string
    // (these are used as separators):
    return str.replace(/\t|\n/g, '');
  },

  replaceControlCharacters: function(str) {
    return str.replace(
      /\n|\t/g,
      this.replaceControlCharactersCallback
    );
  },

  replaceControlCharactersCallback: function(str) {
    switch(str) {
      case "\n":
        return autofillForms.autofillFormsPrefs.getCharPref('placeholderLineBreak');
      case "\t":
        return '  ';
      default:
        return str;
    }
  },

  replaceControlCharacterPlaceholders: function(str) {
    try {
      var regExpObj = new RegExp(
        '('
        +this.autofillFormsPrefs.getCharPref('placeholderLineBreak')
        +')|('
        +this.autofillFormsPrefs.getCharPref('placeholderTab')
        +')',
        'g'
      );
      return str.replace(
        regExpObj,
        this.replaceControlCharacterPlaceholdersCallback
      );
    } catch(e) {
      return str;
    }
  },

  replaceControlCharacterPlaceholdersCallback: function(str) {
    switch(str) {
      case autofillForms.autofillFormsPrefs.getCharPref('placeholderLineBreak'):
        return "\n";
      case autofillForms.autofillFormsPrefs.getCharPref('placeholderTab'):
        return "\t";
      default:
        return str;
    }
  },

  applyFieldRuleOnIndex: function(index) {
    // Check the regular expressions:
    try {
      var fieldRule = this.getRegExpStr(
        this.makeSafe(document.getElementById('fieldRuleFieldRuleTextBox').value)
      );
      document.getElementById('fieldRuleFieldRuleTextBox').value = fieldRule;

      var siteRule = this.getRegExpStr(
        this.makeSafe(document.getElementById('fieldRuleSiteRuleTextBox').value)
      );
      document.getElementById('fieldRuleSiteRuleTextBox').value = siteRule;
    } catch(e) {
      this.invalidRegExpAlert(e);
      return;
    }

    var ruleName = this.makeSafe(document.getElementById('fieldRuleNameTextBox').value);
    var ruleValue = this.makeSafe(document.getElementById('fieldRuleValueTextBox').value);

    if(  this.getFieldRules()[index] && (
      this.getFieldRules()[index]['fieldRuleName'] != ruleName ||
      this.getFieldRules()[index]['fieldRuleValue'] != ruleValue ||
      this.getFieldRules()[index]['fieldRuleFieldRule'] != fieldRule ||
      this.getFieldRules()[index]['fieldRuleSiteRule'] != siteRule)) {
      // Update the formFieldRule on the given index:
      this.getFieldRules()[index]['fieldRuleName'] = ruleName;
      this.getFieldRules()[index]['fieldRuleValue'] = ruleValue;
      this.getFieldRules()[index]['fieldRuleFieldRule'] = fieldRule;
      this.getFieldRules()[index]['fieldRuleSiteRule'] = siteRule;

      // Notify the tree:
      this.treeBox.invalidateRow(index);

      // Update the preferences:
      this.setFieldRules();

      // Update the related row of the simple interface:
      this.updateSimpleInterfaceRow(index);
    }
  },

  applyFieldRule: function(event) {
    // Only apply changes if one item is selected:
    if(this.selection.count == 1) {
      // Update the selected formFieldRule:
      this.applyFieldRuleOnIndex(this.selection.currentIndex);
    }
  },

  addFieldRule: function(event) {
    // See method selectedFieldRule() why this has to be set to null:
    this.lastSelectedIndex = null;

    // Check the regular expressions:
    try {
      var fieldRuleFieldRuleTextBox = document.getElementById('fieldRuleFieldRuleTextBox');
      var fieldRule = this.getRegExpStr(
        this.makeSafe(fieldRuleFieldRuleTextBox.value)
      );
      fieldRuleFieldRuleTextBox.value = fieldRule;

      var fieldRuleSiteRuleTextBox = document.getElementById('fieldRuleSiteRuleTextBox');
      var siteRule = this.getRegExpStr(
        this.makeSafe(fieldRuleSiteRuleTextBox.value)
      );
      fieldRuleSiteRuleTextBox.value = siteRule;
    } catch(e) {
      this.invalidRegExpAlert(e);
      return;
    }

    var newFieldRule =   this.createFieldRule(
      this.makeSafe(document.getElementById('fieldRuleNameTextBox').value),
      this.makeSafe(document.getElementById('fieldRuleValueTextBox').value),
      fieldRule,
      siteRule,
      true,
      true
    )

    var newFieldRuleIndex;

    // Add the new formFieldRule right after the selected position or to the start of the list:
    if(this.selection.currentIndex == -1 || this.selection.currentIndex == this.treeView.rowCount) {
      this.getFieldRules().unshift(newFieldRule);
      newFieldRuleIndex = 0;
    } else {
      newFieldRuleIndex = this.selection.currentIndex+1;
      this.getFieldRules().splice(
        newFieldRuleIndex,
        0,
        newFieldRule
      );
    }

    // Update the tree count and notify the tree:
    this.treeView.rowCount++;
    this.treeBox.rowCountChanged(this.treeView.rowCount, +1);
    this.treeBox.invalidate();

    // Select the new item:
    this.selection.select(newFieldRuleIndex);

    // Ensure row is visible (scrolls if not):
    this.treeBox.ensureRowIsVisible(newFieldRuleIndex);

    // Update the preferences:
    this.setFieldRules();

    // Re-initialize the simple interface:
    this.initSimpleInterface();
  },

  removeFieldRule: function(event) {
    this.removeSelectedFieldRules();
  },

  moveUpFieldRule: function(event) {
    // See method selectedFieldRule() why this has to be set to null:
    this.lastSelectedIndex = null;

    var index = this.selection.currentIndex;

    // Change place with the next upper item:
    var sibling = this.getFieldRules()[index-1];
    this.getFieldRules()[index-1] = this.getFieldRules()[index];
    this.getFieldRules()[index] = sibling;

    // Keep moved item selected:
    this.selection.select(index-1);

    // Notify the tree:
    this.treeBox.invalidate();

    // Ensure row is visible (scrolls if not):
    this.treeBox.ensureRowIsVisible(index-1);

    // Update the preferences:
    this.setFieldRules();

    // Update the related rows of the simple interface:
    this.updateSimpleInterfaceRow(index-1);
    this.updateSimpleInterfaceRow(index);
  },

  moveDownFieldRule: function(event) {
    // See method selectedFieldRule() why this has to be set to null:
    this.lastSelectedIndex = null;

    var index = this.selection.currentIndex;

    // Change place with the next lower item:
    var sibling = this.getFieldRules()[index+1];
    this.getFieldRules()[index+1] = this.getFieldRules()[index];
    this.getFieldRules()[index] = sibling;

    // Keep moved item selected:
    this.selection.select(index+1);

    // Notify the tree:
    this.treeBox.invalidate();

    // Ensure row is visible (scrolls if not):
    this.treeBox.ensureRowIsVisible(index+1);

    // Update the preferences:
    this.setFieldRules();

    // Update the related rows of the simple interface:
    this.updateSimpleInterfaceRow(index+1);
    this.updateSimpleInterfaceRow(index);
  },

  removeSelectedFieldRules: function(event) {
    // See method selectedFieldRule() why this has to be set to null:
    this.lastSelectedIndex = null;

    if(this.autofillFormsPrefs.getBoolPref('enableConfirmationDialogs')) {
      // Confirmation dialog:
      if(!this.getPrompts().confirm(
          null,
          this.getStringBundle().getString('removeFieldRulesTitle'),
          this.getStringBundle().getString('removeFieldRulesText')
        )
      ) {
        return;
      }
    }

    // Start of update batch:
    this.treeBox.beginUpdateBatch();

    // Helper object to store a range:
    function Range(start, end) {
      this.start = start.value;
      this.end = end.value;
    }

    // List of ranges:
    var ranges = new Array();

    // Get the number of ranges:
    var numRanges = this.selection.getRangeCount();

    // Helper vars to store the range end points:
    var start = new Object();
    var end = new Object();

    // We store the list of ranges first, as calling
    // this.treeBox.rowCountChanged()
    // seems to invalidate the current selection

    for(var i=0; i < numRanges; i++) {
      // Get the current range end points:
      this.selection.getRangeAt(i,start,end);
      // Store them as a Range object in the ranges list:
      ranges[i] = new Range(start, end);
    }

    for(var i=0; i < numRanges; i++) {
      // Go through the stored ranges:
      for(var j = ranges[i].start; j <= ranges[i].end; j++) {
        // Set the selected fieldRules to null:
        this.getFieldRules()[j] = null;
      }

      // Calculate the new tree count:
      var count = ranges[i].end - ranges[i].start + 1;

      // Update the tree count and notify the tree:
      this.treeView.rowCount -= count;
      this.treeBox.rowCountChanged(ranges[i].start, -count);
    }

    // Collapse list by removing all the null entries
    for (var i=0; i < this.getFieldRules().length; i++) {
      if (!this.getFieldRules()[i]) {
        var j = i;
        while (j < this.getFieldRules().length && !this.getFieldRules()[j])
          j++;
        this.getFieldRules().splice(i, j-i);
      }
    }

    // Clear out selections
    this.selection.select(-1);

    // End of update batch:
    this.treeBox.endUpdateBatch();

    // Update the preferences:
    this.setFieldRules();

    // Re-initialize the simple interface:
    this.initSimpleInterface();
  },

  handleKeyPress: function(event) {
    if(event.keyCode == 46) {
      this.removeSelectedFieldRules();
    } else if(event.ctrlKey && event.which == 97) {
      if(this.tree && this.selection) {
        try {
          // Select all rows:
          this.selection.selectAll();
        } catch(e) {
          this.log(e);
        }
      }
    }
  },

  getGlobalFieldRules: function() {
    // Return the fieldRules for the selected global profile if globalProfileIndex is not out of range:
    if(this.getGlobalProfileIndex() >= 0 && this.getGlobalProfileIndex() < this.getProfileLabels().length) {
      return this.getFieldRules(this.getGlobalProfileIndex());
    } else {
      this.globalProfileIndex = 0;
      return this.getFieldRules(0);
    }
  },

  getFileContent: function(file) {
    var fileContent = null;
    try {
      var fis = Components.classes['@mozilla.org/network/file-input-stream;1']
            .createInstance(Components.interfaces.nsIFileInputStream);
      fis.init(file, -1, 0, 0);
      var is = Components.classes['@mozilla.org/intl/converter-input-stream;1']
            .createInstance(Components.interfaces.nsIConverterInputStream);
      is.init(fis, 'UTF-8', 1024, Components.interfaces.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);
      if(is instanceof Components.interfaces.nsIUnicharLineInputStream) {
        var line = {};
        var cont;
        do {
          cont = is.readLine(line);
          if(fileContent == null) {
            fileContent = line.value;
          } else {
            fileContent += '\n'+line.value;
          }
        } while (cont);
      }
      is.close();
      fis.close();
    } catch(e) {
      this.log(e);
    }
    return fileContent;
  },

  setFileContent: function(file, str) {
    try {
      var fos = Components.classes['@mozilla.org/network/file-output-stream;1']
            .createInstance(Components.interfaces.nsIFileOutputStream);
      fos.init(file, 0x02 | 0x08 | 0x20, 0664, 0);
      var os = Components.classes['@mozilla.org/intl/converter-output-stream;1']
            .createInstance(Components.interfaces.nsIConverterOutputStream);
      os.init(fos, 'UTF-8', 4096, Components.interfaces.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);
      os.writeString(str);
      os.close();
      fos.close();
    } catch(e) {
      this.log(e);
    }
  },

  getFieldRulesFile: function() {
    var file = this.getConfigDirectory();
    file.append('fieldRules.txt');
    if(!file.exists()) {
      file.create(Components.interfaces.nsIFile.NORMAL_FILE_TYPE, 0660);
    }
    return file;
  },

  getConfigDirectory: function() {
    var configDirectory;
    if(this.autofillFormsPrefs.prefHasUserValue('configDirectory')) {
      try {
        configDirectory = this.autofillFormsPrefs.getComplexValue(
                    'configDirectory',
                    Components.interfaces.nsILocalFile
        );
      } catch(e) {
        this.autofillFormsPrefs.clearUserPref('configDirectory');
      }
    }
    if(!configDirectory) {
      configDirectory = this.getDefaultConfigDirectory();
    }
    return configDirectory;
  },

  getDefaultConfigDirectory: function() {
    // Use a directory "autofillForms@blueimp.net" inside Firefox profile directory as default:
    var configDirectory = Components.classes['@mozilla.org/file/directory_service;1']
                .getService(Components.interfaces.nsIProperties)
                .get('ProfD', Components.interfaces.nsILocalFile);
    configDirectory.append('autofillForms@blueimp.net');
    if(!configDirectory.exists()) {
       configDirectory.create(Components.interfaces.nsIFile.DIRECTORY_TYPE, 0770);
    }
    return configDirectory;
  },

  setConfigDirectory: function(textBox) {
    try {
      // Create a file picker instance:
      var fp = Components.classes['@mozilla.org/filepicker;1']
            .createInstance(Components.interfaces.nsIFilePicker);

      // Initialize the file picker window:
      fp.init(
        window,
        this.getStringBundle().getString('selectConfigDirectory'),
        Components.interfaces.nsIFilePicker.modeGetFolder
      );

      // Show the file picker window:
      var rv = fp.show();

      if (rv == Components.interfaces.nsIFilePicker.returnOK) {
        var newDir = fp.file;
        if(newDir.path == this.getConfigDirectory().path) {
          return;
        }
        this.moveConfigFiles(newDir);
        // Save the selected directory in the preferences:
        this.autofillFormsPrefs.setComplexValue(
          'configDirectory',
          Components.interfaces.nsILocalFile, newDir
        );
        if(textBox) {
          // Set the textbox value to the directory path:
          textBox.value = newDir.path;
        }
      }
    } catch(e) {
      this.log(e);
    }
  },

  resetConfigDirectory: function(textBox) {
    if(this.autofillFormsPrefs.prefHasUserValue('configDirectory')) {
      var newDir = this.getDefaultConfigDirectory();
      this.moveConfigFiles(newDir);
      this.autofillFormsPrefs.clearUserPref('configDirectory');
      if(textBox) {
        // Set the textbox value to an empty string:
        textBox.value = '';
      }
    }
  },

  openConfigDirectory: function() {
    var configDirectory = this.getConfigDirectory();
    if(configDirectory) {
      try {
        // Open the config directory in the operating system file manager:
        configDirectory.reveal();
      } catch(e) {
        // reveal method may not be supported on some platforms,
        // use nsIExternalProtocolService instead:
        var uri = Components.classes["@mozilla.org/network/io-service;1"]
          .getService(Components.interfaces.nsIIOService)
          .newFileURI(configDirectory);
        var protocolSvc =
        Components.classes["@mozilla.org/uriloader/external-protocol-service;1"]
          .getService(Components.interfaces.nsIExternalProtocolService);
        protocolSvc.loadUrl(uri);
      }
    }
  },

  moveConfigFiles: function(newDir) {
    if(this.checkConfigDirectoryOverwrite(newDir)) {
      this.moveFile(this.getFieldRulesFile(), newDir);
      this.moveFile(this.getDynamicTagsFile(), newDir);
      this.moveFile(this.getDynamicTagCodesFile(), newDir);
      this.moveFile(this.getProfileLabelsFile(), newDir);
      this.moveFile(this.getProfileSiteRulesFile(), newDir);
      return true;
    }
    return false;
  },

  importFromConfigDirectory: function() {
    var ok = true;
    if(this.autofillFormsPrefs.getBoolPref('enableConfirmationDialogs')) {
      ok = this.getPrompts().confirm(
        window,
        this.getStringBundle().getString('importFromConfigDirectoryTitle'),
        this.getStringBundle().getString('importFromConfigDirectoryText')
      );
    }
    if(ok) {
      this.importFieldRulesFromConfigDirectory();
      this.importDynamicTagsFromConfigDirectory();
      this.importDynamicTagCodesFromConfigDirectory();
      this.importProfileLabelsFromConfigDirectory();
      this.importProfileSiteRulesFromConfigDirectory();
    }
  },

  exportToConfigDirectory: function() {
    if(this.checkConfigDirectoryOverwrite(this.getConfigDirectory())) {
      this.exportFieldRulesToConfigDirectory();
      this.exportDynamicTagsToConfigDirectory();
      this.exportDynamicTagCodesToConfigDirectory();
      this.exportProfileLabelsToConfigDirectory();
      this.exportProfileSiteRulesToConfigDirectory();
      return true;
    }
    return false;
  },

  moveFile: function(file, newDir, newFileName) {
    try {
      // The new fileName - uses the current fileName if empty:
      newFileName = (typeof newFileName == 'string') ? newFileName : null;

      file.moveTo(newDir, newFileName);
      return true;
    } catch(e) {
      this.log(e);
      return false;
    }
  },

  checkConfigDirectoryOverwrite: function(newDir) {
    var ok = true;
    if(this.autofillFormsPrefs.getBoolPref('enableConfirmationDialogs')) {
      if(newDir.directoryEntries.hasMoreElements()) {
        ok = this.getPrompts().confirm(
          window,
          this.getStringBundle().getString('newConfigDirectoryNotEmptyTitle'),
          this.getStringBundle().getString('newConfigDirectoryNotEmptyText')
        );
      }
    }
    return ok;
  },

  exportFieldRulesToConfigDirectory: function() {
    var prefString;
    // Get the fieldRules string from the preferences:
    prefString = this.autofillFormsPrefs
              .getComplexValue('fieldRules',Components.interfaces.nsIPrefLocalizedString)
              .data;
    if(prefString) {
      this.setFileContent(this.getFieldRulesFile(), prefString);
    }
  },

  importFieldRulesFromConfigDirectory: function() {
    var prefString;
    prefString = this.getFileContent(this.getFieldRulesFile());
    if(prefString) {
      // Store the fieldRules as unicode string in the preferences:
      this.autofillFormsPrefs.setComplexValue(
        'fieldRules',
        Components.interfaces.nsISupportsString,
        this.getUnicodeString(prefString)
      );
    }
  },

  getFieldRules: function(profileIndex) {
    if(this.fieldRules == null) {
      this.fieldRules = new Array();

      var prefString;
      if(this.autofillFormsPrefs.getBoolPref('useConfigDirectory')) {
        // Get the fieldRules string from the fieldRules file in the configDirectory:
        prefString = this.getFileContent(this.getFieldRulesFile());
      }
      if(!prefString) {
        // Get the fieldRules string from the preferences:
        prefString = this.autofillFormsPrefs
                  .getComplexValue('fieldRules',Components.interfaces.nsIPrefLocalizedString)
                  .data;
      }

      // On change of the "storeEncrypted" setting, we must decrypt or may not decrypt
      // the prefString in opposition to the setting - the "invertedSetting" helper var
      // helps to identify this situation:
      var boolTest = this.invertedSetting ? false : true;

      // If the fieldRules are stored encrypted, decrypt the prefString:
      if(this.autofillFormsPrefs.getBoolPref('storeEncrypted') == boolTest) {
        try {
          // nsISecretDecoderRing fails to handle characters above ISO-8859-1 charset
          // The usage of encodeURI/decodeURI on the fieldRule properties bypasses this problem
          prefString = this.getCryptoService().decryptString(prefString);
        } catch(e) {
          // Decrypting failed - return an empty default profile:
          this.fieldRules.push(new Array());
          this.profileIndex = 0;
          return this.fieldRules[0];
        }
      }

      // Get the profiles (separated by \n\n):
      var profiles = prefString.split('\n\n');

      for(var i=0; i<profiles.length; i++) {
        // Create an array for each profile:
        this.fieldRules.push(new Array());

        // Get the fieldRules rows (separated by \n):
        var rows = profiles[i].split('\n');
        if(rows[0]) {
          for(var j=0; j<rows.length; j++) {
            if(!rows[j])
              continue;

            // Get the fieldRules column items (separated by \t):
            var cols = rows[j].split('\t');

            // Create fieldRules objects and save them in the current fieldRules Array:
            if(cols.length && cols.length == 6) {

              // Decode the fieldRule properties:
              for(var k=0; k<cols.length; k++) {
                cols[k] = decodeURI(cols[k]);
              }

              this.fieldRules[i].push(
                this.createFieldRule(
                  cols[0],cols[1],cols[2],cols[3],
                  (cols[4] != 'false'),
                  (cols[5] != 'false')
                )
              );
            }
          }
        } else
          this.fieldRules[i] = new Array();
      }
    }

    profileIndex = (typeof profileIndex != 'undefined') ? profileIndex : this.getProfileIndex();

    // Return the fieldRules for the selected profile if profileIndex is not out of range:
    if(profileIndex >= 0 && profileIndex < this.fieldRules.length)
      return this.fieldRules[profileIndex];
    else {
      this.profileIndex = 0;
      if(this.fieldRules[0] == null)
        this.fieldRules[0] = new Array();
      return this.fieldRules[0];
    }
  },

  setFieldRules: function() {
    if(this.fieldRules == null) {
      // Initialize the field rules:
      this.getFieldRules();
    }

    var profiles = '';
    var rows, cols;
    for(var i=0; i < this.fieldRules.length; i++) {
      rows = '';
      for(var j=0; j<this.fieldRules[i].length; j++) {
        cols = null;
        for(var property in this.fieldRules[i][j]) {
          if(cols == null)
            cols = '';
          else
            cols += '\t';
          // Encode the fieldRule property before adding it to the string:
          cols += encodeURI(this.fieldRules[i][j][property]);
        }
        if(j!=0)
          rows += '\n';
        rows += cols;
      }
      if(i!=0)
        profiles += '\n\n';
      profiles += rows;
    }

    // If the fieldRules are to be stored encrypted, encrypt the prefString:
    if(this.autofillFormsPrefs.getBoolPref('storeEncrypted')) {
      try {
        // nsISecretDecoderRing fails to handle characters above ISO-8859-1 charset
        // The usage of encodeURI/decodeURI on the fieldRule properties bypasses this problem
        profiles = this.getCryptoService().encryptString(profiles);
      } catch(e) {
        // Decrypting failed - return:
        return;
      }
    }

    if(this.autofillFormsPrefs.getBoolPref('useConfigDirectory')) {
      this.setFileContent(this.getFieldRulesFile(), profiles);
    } else {
      // Store the fieldRules objects as unicode string in the preferences:
      this.autofillFormsPrefs.setComplexValue(
        'fieldRules',
        Components.interfaces.nsISupportsString,
        this.getUnicodeString(profiles)
      );
    }
  },

  copyFieldRules: function(origin) {
    var copy = new Array();
    for(var i=0; i<origin.length; i++) {
      copy.push(
        this.createFieldRule(
          origin[i]['fieldRuleName'],
          origin[i]['fieldRuleValue'],
          origin[i]['fieldRuleFieldRule'],
          origin[i]['fieldRuleSiteRule'],
          origin[i]['fieldRuleOverwrite'],
          origin[i]['fieldRuleEnabled']
        )
      )
    }
    return copy;
  },
  importDynamicTagsFromSettings: function() {
    //Here the tags are added directly
    var prefString = null;

    prefString = this.autofillFormsPrefs
              .getComplexValue('dynamicTags',Components.interfaces.nsIPrefLocalizedString)
              .data;
    var dynamicTags = prefString.split('\t');

    prefString = this.autofillFormsPrefs
              .getComplexValue('dynamicTagCodes',Components.interfaces.nsIPrefLocalizedString)
              .data;
    var dynamicTagCodes = prefString.split('\t');

    this.importDynamicTags(dynamicTags, dynamicTagCodes);
    this.setDynamicTags(dynamicTags);
    this.setDynamicTagCodes(dynamicTagCodes);
  },
  importDynamicTagsFromTagEditor: function() {
    //Here the tags are added to the editor window, can be cancelled if necessary
    var richlistbox = document.getElementById('tagList');
    if(richlistbox) {
      var richlistitems = richlistbox.getElementsByTagName('richlistitem');
      var textboxes;

      var dynamicTags = new Array();
      var dynamicTagCodes = new Array();

      // Go through the richlistbox items:
      for(var i=0; i<richlistitems.length; i++) {
        textboxes = richlistitems[i].getElementsByTagName('textbox');

        // Add the dynamic tags and their associated tag codes to the lists:
        if (textboxes[0].value != '' && textboxes[1].value != '') {
          dynamicTags.push(this.makeSafe(textboxes[0].value));
          dynamicTagCodes.push(this.makeSafe(textboxes[1].value));
        }
      }
      this.importDynamicTags(dynamicTags, dynamicTagCodes);
    }
  },
  importDynamicTags: function(dynamicTags, dynamicTagCodes) {
    try {
      var file = this.filePicker('modeOpen', this.getStringBundle().getString('importDynamicTags'));
      if(file) {
        var fis = Components.classes['@mozilla.org/network/file-input-stream;1']
                .createInstance(Components.interfaces.nsIFileInputStream);
        fis.init(file, -1, 0, 0);

        var is = Components.classes['@mozilla.org/intl/converter-input-stream;1']
              .createInstance(Components.interfaces.nsIConverterInputStream);
        is.init(fis, 'UTF-8', 1024, Components.interfaces.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);

        if (is instanceof Components.interfaces.nsIUnicharLineInputStream) {
          var line = {};
          var cont;
          var firstLine = true;
          var i;

          do {
            cont = is.readLine(line);

            // Get the dynamicTags column items (separated by \t) from the file:
            var cols = line.value.split('\t');

            if (firstLine == true) {
              // The first row has the following syntax (added in version 0.9.5):
              // autofillForms@blueimp.net  Version  dynamictags
              if(cols.length && cols.length != 3)
                cont = false;
              else if (cols[0] != 'autofillForms@blueimp.net')
                cont = false;
              else if (cols[2] != 'dynamictags')
                cont = false;
              firstLine = false;
            }
            else if (cols.length && cols.length == 2) {
              //Check the imported pair isn't already defined or empty.
              i = dynamicTags.indexOf(cols[0]);
              if ((i >= 0 && dynamicTagCodes[i] == cols[1])||(cols[0]=='' && cols[1]=='')) {
                continue;
              } else {
                dynamicTags.push(cols[0]);
                dynamicTagCodes.push(cols[1]);
                this.tagEditorAdd(cols[0],cols[1])
              }
            }
          } while (cont);

        }
        is.close();
        fis.close();
      }
    } catch(e) {
      this.log(e);
    }
  },
  exportDynamicTagsFromSettings: function() {
    var prefString = null;

    // Write the tags to file analog to storing them in the preferences:
    prefString = this.autofillFormsPrefs
              .getComplexValue('dynamicTagCodes',Components.interfaces.nsIPrefLocalizedString)
              .data;
    var dynamicTagCodes = prefString.split('\t');

    prefString = this.autofillFormsPrefs
              .getComplexValue('dynamicTags',Components.interfaces.nsIPrefLocalizedString)
              .data;
    var dynamicTags = prefString.split('\t');
    this.exportDynamicTags(dynamicTags, dynamicTagCodes);
  },
  exportDynamicTagsFromTagEditor: function() {
    var richlistbox = document.getElementById('tagList');
    if(richlistbox) {
      var richlistitems = richlistbox.getElementsByTagName('richlistitem');
      var textboxes;

      var dynamicTags = new Array();
      var dynamicTagCodes = new Array();

      // Go through the richlistbox items:
      for(var i=0; i<richlistitems.length; i++) {
        textboxes = richlistitems[i].getElementsByTagName('textbox');

        // Add the dynamic tags and their associated tag codes to the lists:
        if (textboxes[0].value != '' && textboxes[1].value != '') {
          dynamicTags.push(this.makeSafe(textboxes[0].value));
          dynamicTagCodes.push(this.makeSafe(textboxes[1].value));
        }
      }
      this.exportDynamicTags(dynamicTags, dynamicTagCodes);
    }
  },
  exportDynamicTags: function(dynamicTags, dynamicTagCodes) {
    try {
      var file = this.filePicker(
        'modeSave',
        this.getStringBundle().getString('exportDynamicTags'),
        this.getProfileLabel(this.getProfileIndex())+'.txt'
      );
      if(file) {
        var fos = Components.classes['@mozilla.org/network/file-output-stream;1'].
                    createInstance(Components.interfaces.nsIFileOutputStream);
        fos.init(file, 0x02 | 0x08 | 0x20, 0664, 0); // write, create, truncate

        var os = Components.classes['@mozilla.org/intl/converter-output-stream;1']
              .createInstance(Components.interfaces.nsIConverterOutputStream);
        os.init(fos, 'UTF-8', 4096, Components.interfaces.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);


        var header = 'autofillForms@blueimp.net' + '\t'
                + this.version + '\t'
                + 'dynamictags\n';
        os.writeString(header);

        var cols;
        for(var i=0; i<dynamicTags.length; i++) {
          cols = dynamicTags[i]+'\t'+dynamicTagCodes[i];
          os.writeString('\n' + cols);
        }
        os.close();
        fos.close();
      }
    } catch(e) {
      this.log(e);
    }
  },
  importProfile: function() {
    try {
      var file = this.filePicker('modeOpen', this.getStringBundle().getString('importProfile'));
      if(file) {
        var fis = Components.classes['@mozilla.org/network/file-input-stream;1']
                .createInstance(Components.interfaces.nsIFileInputStream);
        fis.init(file, -1, 0, 0);

        var is = Components.classes['@mozilla.org/intl/converter-input-stream;1']
              .createInstance(Components.interfaces.nsIConverterInputStream);
        is.init(fis, 'UTF-8', 1024, Components.interfaces.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);

        if(this.fieldRules == null) {
          // Initialize the field rules:
          this.getFieldRules();
        }

        // Create a new fieldRule profile (index is incremented when a valid header is found):
        var newProfileLabel = '';
        var newProfileSiteRule = '(?:)';
        var newProfileIndex = this.fieldRules.length-1;
        var validProfile = false;

        if (is instanceof Components.interfaces.nsIUnicharLineInputStream) {
          var line = {};
          var cont;
          do {
            cont = is.readLine(line);

            // Get the fieldRules column items (separated by \t) from the file:
            var cols = line.value.split('\t');

            if(cols.length && cols.length < 6 && cols[0] == 'autofillForms@blueimp.net') {
              // The first row has the following syntax (added SiteRule for version 0.9.1):
              // autofillForms@blueimp.net  Version  Label  SiteRule
              // Every time such a row is encountered, a new profile is generated.
              if(cols.length >= 3) {
                newProfileLabel = cols[2];
                // Add profile label for default empty profile:
                if(this.getProfileLabels().length == 0) {
                  this.getProfileLabels().push(this.getUniqueProfileLabel());
                }
                // Add the newProfileLabel to the profileLabels list (make sure it is unique):
                this.getProfileLabels().push(this.getUniqueProfileLabel(newProfileLabel));
              }
              if(cols.length >= 4) {
                try {
                  newProfileSiteRule = this.getRegExpStr(cols[3]);
                  // Add a new profileSiteRule:
                  this.getProfileSiteRules().push(newProfileSiteRule);
                } catch(e) {
                  // Catch missing or invalid site rule
                }
              }
              // Increment the ProfileIndex
              newProfileIndex += 1;
              this.fieldRules.push(new Array());
              validProfile = true;
            } else if(cols.length && cols.length == 6 && validProfile == true) {
              // Create fieldRules objects and save them in the fieldRules Array:
              this.fieldRules[newProfileIndex].push(
                this.createFieldRule(
                  cols[0],cols[1],cols[2],cols[3],
                  (cols[4] != 'false'),
                  (cols[5] != 'false')
                )
              );
            }

          } while (cont);
        }

        // Save the profileLabels list in the preferences:
        this.setProfileLabels(this.getProfileLabels());
        // Save the profileSiteRules in the preferences:
        this.setProfileSiteRules(this.getProfileSiteRules());
        // Update the profiles lists:
        this.initProfilesLists();

        // Update the fieldRules:
        this.setFieldRules();

        is.close();
        fis.close();
      }
    } catch(e) {
      this.log(e);
    }
  },
  exportProfile: function() {
    try {
      var file = this.filePicker(
        'modeSave',
        this.getStringBundle().getString('exportProfile'),
        this.getProfileLabel(this.getProfileIndex())+'.txt'
      );
      if(file) {
        var fos = Components.classes['@mozilla.org/network/file-output-stream;1'].
                    createInstance(Components.interfaces.nsIFileOutputStream);
        fos.init(file, 0x02 | 0x08 | 0x20, 0664, 0); // write, create, truncate

        var os = Components.classes['@mozilla.org/intl/converter-output-stream;1']
              .createInstance(Components.interfaces.nsIConverterOutputStream);
        os.init(fos, 'UTF-8', 4096, Components.interfaces.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);

        var profileIndex = this.getProfileIndex();
        this.writeProfile(os, profileIndex);

        os.close();
        fos.close();
      }
    } catch(e) {
      this.log(e);
    }
  },
  exportAllProfiles: function() {
    try {
      //use the first profile label as the filename
      var file = this.filePicker(
        'modeSave',
        this.getStringBundle().getString('exportProfile'),
        this.getProfileLabel(0)+'.txt'
      );
      if(file) {
        var fos = Components.classes['@mozilla.org/network/file-output-stream;1'].
                    createInstance(Components.interfaces.nsIFileOutputStream);
        fos.init(file, 0x02 | 0x08 | 0x20, 0664, 0); // write, create, truncate

        var os = Components.classes['@mozilla.org/intl/converter-output-stream;1']
              .createInstance(Components.interfaces.nsIConverterOutputStream);

        os.init(fos, 'UTF-8', 4096, Components.interfaces.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);

        for(var i=0; i<this.getProfileLabels().length; i++) {
          this.writeProfile(os, i);
          os.writeString('\n\n');
        }
        os.close();
        fos.close();
      }
    } catch(e) {
      this.log(e);
    }
  },
  writeProfile: function(os, profileIndex) {
    try {
      var header = 'autofillForms@blueimp.net' + '\t'
            + this.version + '\t'
            + this.getProfileLabel(profileIndex) + '\t'
            + this.getProfileSiteRule(profileIndex) + '\n';


      os.writeString(header);
      // Write the rules to file analog to storing them in the preferences:
      var cols;
      for(var i=0; i<this.getFieldRules(profileIndex).length; i++) {
        cols = null;
        for(var property in this.getFieldRules(profileIndex)[i]) {
          if(cols == null)
            cols = '';
          else
            cols += '\t';
          cols += this.getFieldRules(profileIndex)[i][property];
        }
        os.writeString('\n' + cols);
      }
    } catch(e) {
      this.log(e);
    }
  },
  filePicker: function(mode, title, fileName) {
    try {
      // Create a file picker instance:
      var fp = Components.classes['@mozilla.org/filepicker;1']
            .createInstance(Components.interfaces.nsIFilePicker);

      // The filename suggested to the user as a default:
      if(fileName) {
        fp.defaultString = fileName;
      }

      // Initialize the file picker window:
      fp.init(
        window,
        title,
        Components.interfaces.nsIFilePicker[mode]
      );

      // Show the file picker window:
      var rv = fp.show();

      if(rv==Components.interfaces.nsIFilePicker.returnOK || rv==Components.interfaces.nsIFilePicker.returnReplace)
        return fp.file;
      else
        return null;
    } catch(e) {
      return null;
    }
  },

  getUnicodeString: function(stringData) {
    // Create an Unicode String:
    var str = Components.classes['@mozilla.org/supports-string;1']
          .createInstance(Components.interfaces.nsISupportsString);
    // Set the String value:
    str.data = stringData;
    // Return the Unicode String:
    return str;
  },

  getStringBundle: function() {
    return document.getElementById('autofillFormsStringBundle');
  },

  getDoc: function(win) {
    if(win)
      return win.document;
    else if(content)
      return content.document;
    else
      return this.getBrowser().contentDocument;
  },

  getWin: function() {
    if(content)
      return content;
    else
      return this.getBrowser().contentWindow;
  },

  getBrowser: function() {
    try {
      return gBrowser;
    } catch(e) {
      // gBrowser is not available, so make use of the WindowMediator service instead:
      return this.getWindowMediator().getMostRecentWindow('navigator:browser').getBrowser();
    }
  },

  getWindowMediator: function() {
    return Components.classes['@mozilla.org/appshell/window-mediator;1']
        .getService(Components.interfaces.nsIWindowMediator);
  },

  getRegExpStr: function(str) {
    // Create a RegExp object using the given String:
    var regExpStr = new RegExp(str).toString();
    // Return the String representation without the surrounding slashes:
    return regExpStr.substr(1,regExpStr.length-2);
  },

  getPrefManager: function() {
    return Components.classes['@mozilla.org/preferences-service;1']
        .getService(Components.interfaces.nsIPrefService);
  },

  getCryptoService: function() {
    return Components.classes['@mozilla.org/security/sdr;1']
        .createInstance(Components.interfaces.nsISecretDecoderRing);
  },

  getPrompts: function() {
    return Components.classes['@mozilla.org/embedcomp/prompt-service;1']
        .getService(Components.interfaces.nsIPromptService);
  },

  recognizeMouseButton: function(event) {
    var modifiers = new Array();

    // Get the modifiers:
    if(event.altKey) modifiers.push('alt');
    if(event.ctrlKey) modifiers.push('control');
    if(event.metaKey) modifiers.push('meta');
    if(event.shiftKey) modifiers.push('shift');

    // Return a mouseButtonObj:
    return this.mouseButtonFactory(modifiers, 'mousebutton'+event.button);
  },

  mouseButtonFactory: function(modifiers, mouseButton) {
    if(typeof arguments.callee.mouseButtonObj == 'undefined') {
      arguments.callee.mouseButtonObj = function(modifiers, mouseButton) {
        this.modifiers = modifiers ? modifiers : new Array();
        this.mouseButton = mouseButton;
        this.toString = function() {
          if(this.modifiers.length) {
            return this.modifiers.join('+')+'+'+this.mouseButton;
          } else {
            return this.mouseButton;
          }
        }
        this.equals = function(mouseButtonObj) {
          if(this.mouseButton != mouseButtonObj.mouseButton) {
            return false;
          }
          if(this.modifiers.length != mouseButtonObj.modifiers.length) {
            return false;
          }
          for(var i=0; i<this.modifiers.length; i++) {
            if(this.modifiers[i] != mouseButtonObj.modifiers[i]) {
              return false;
            }
          }
          return true;
        }
        return this;
      }
    }
    return new arguments.callee.mouseButtonObj(modifiers, mouseButton);
  },

  getFormattedMouseButton: function(mouseButtonObj) {
    var formattedMouseButton = '';
    if(!mouseButtonObj.mouseButton) {
      return formattedMouseButton;
    }
    // Add the modifiers:
    for(var i=0; i < mouseButtonObj.modifiers.length; i++) {
      try {
        formattedMouseButton += this.getStringBundle().getString(mouseButtonObj.modifiers[i])+'+';
      } catch(e) {
        this.log(e);
        // Error in shortcut string, return empty String:
        return '';
      }
    }
    try {
      formattedMouseButton += this.getStringBundle().getString(mouseButtonObj.mouseButton);
    } catch(e) {
      // No localization for this mouse button, add generic button string :
      formattedMouseButton += this.getStringBundle().getString('mousebutton');
      // Add the index of the given mouseButton:
      formattedMouseButton += ' '+mouseButtonObj.mouseButton.substr('mousebutton'.length);
    }
    return formattedMouseButton;
  },

  applyMouseButton: function(event, id) {
    // Recognize the mouse button event:
    var mouseButtonObj = this.recognizeMouseButton(event);
    if(!mouseButtonObj)
      return;
    // Ignore the right mouse button (mousebutton2), as this already invokes the context menu:
    if(mouseButtonObj.mouseButton == 'mousebutton2') {
      return;
    }
    // Save the new mouse button object:
    this.setMouseButton(id, mouseButtonObj);
    // Update the mouse button textbox:
    if(event.view.document && event.view.document.getElementById(id)) {
      event.view.document.getElementById(id).value = this.getFormattedMouseButton(mouseButtonObj);
    }
  },

  disableMouseButton: function(event, id) {
    // Disable the mouse button:
    this.setMouseButton(id, null);
    // Update the mouse button textbox:
    if(event.view.document && event.view.document.getElementById(id)) {
      event.view.document.getElementById(id).value = '';
    }
  },

  getMouseButton: function(id) {
    if(this.mouseButton == null) {
      // Create a new mouseButton container object:
      this.mouseButton = new Object();
    }
    if(this.mouseButton[id] == null) {
      var mouseButtonItems = this.autofillFormsPrefs.getCharPref(id).split('+');
      var mouseButton;
      if(mouseButtonItems.length == 0) {
        mouseButton = '';
      } else {
        // Remove the last element and save it as mouseButton
        // the remaining mouseButtonItems are the modifiers:
        mouseButton = mouseButtonItems.pop();
      }
      // Create a new mouseButton object:
      this.mouseButton[id] = this.mouseButtonFactory(mouseButtonItems, mouseButton);
    }
    return this.mouseButton[id];
  },

  setMouseButton: function(id, mouseButtonObj) {
    var stringData;
    if(mouseButtonObj) {
      stringData = mouseButtonObj.toString();
    } else {
      stringData = '';
    }
    // Save the mouseButtonObj as Unicode String in the preferences:
    this.autofillFormsPrefs.setComplexValue(
      id,
      Components.interfaces.nsISupportsString,
      this.getUnicodeString(stringData)
    );
  },

  recognizeKeys: function(event) {
    var modifiers = new Array();
    var key = '';
    var keycode = '';

    // Get the modifiers:
    if(event.altKey) modifiers.push('alt');
    if(event.ctrlKey) modifiers.push('control');
    if(event.metaKey) modifiers.push('meta');
    if(event.shiftKey) modifiers.push('shift');

    // Get the key or keycode:
    if(event.charCode) {
      key = String.fromCharCode(event.charCode).toUpperCase();
    } else {
      // Get the keycode from the keycodes list:
      keycode = this.getKeyCodes()[event.keyCode];
      if(!keycode) {
        return null;
      }
    }

    // Shortcut may be anything, but not 'VK_TAB' alone (without modifiers),
    // as this button is used to change focus to the 'Apply' button:
    if(modifiers.length > 0 || keycode != 'VK_TAB') {
      return this.shortcutFactory(modifiers, key, keycode);
    }
    return null;
  },

  shortcutFactory: function(modifiers, key, keycode) {
    if(typeof arguments.callee.shortcut == 'undefined') {
      arguments.callee.shortcut = function(modifiers, key, keycode) {
        this.modifiers = modifiers ? modifiers : new Array();
        this.key = key;
        this.keycode = keycode;
        this.toString = function() {
          if(this.modifiers.length) {
            return this.modifiers.join('+')+'+'+this.key+this.keycode;
          } else {
            return this.key+this.keycode;
          }
        }
        this.equals = function(shortcut) {
          if(this.key != shortcut.key) {
            return false;
          }
          if(this.keycode != shortcut.keycode) {
            return false;
          }
          if(this.modifiers.length != shortcut.modifiers.length) {
            return false;
          }
          for(var i=0; i<this.modifiers.length; i++) {
            if(this.modifiers[i] != shortcut.modifiers[i]) {
              return false;
            }
          }
          return true;
        }
        return this;
      }
    }
    return new arguments.callee.shortcut(modifiers, key, keycode);
  },

  getKeyCodes: function() {
    var keycodes = new Array();
    // Get the list of keycodes from the KeyEvent object:
    for(var property in KeyEvent) {
      keycodes[KeyEvent[property]] = property.replace('DOM_','');
    }
    // VK_BACK_SPACE (index 8) must be VK_BACK:
    keycodes[8] = 'VK_BACK';
    return keycodes;
  },

  applyShortcut: function(event, id) {
    // Recognize the pressed keys:
    var shortcut = this.recognizeKeys(event)
    if(!shortcut)
      return;
    // Save the new shortcut:
    this.setShortcut(id, shortcut);
    // Update the shortcut textbox:
    if(event.view.document && event.view.document.getElementById(id)) {
      event.view.document.getElementById(id).value = this.getFormattedShortcut(shortcut);
    }
  },

  disableShortcut: function(event, id) {
    // Disable the shortcut:
    this.setShortcut(id, null);
    // Update the shortcut textbox:
    if(event.view.document && event.view.document.getElementById(id)) {
      event.view.document.getElementById(id).value = '';
    }
  },

  getShortcut: function(id) {
    if(this.shortcut == null) {
      // Create a new shortcut container object:
      this.shortcut = new Object();
    }
    if(this.shortcut[id] == null) {
      var key = null;
      var keycode = null;
      var shortcutItems = this.autofillFormsPrefs
                .getComplexValue(id,Components.interfaces.nsIPrefLocalizedString)
                .data.split('+');
      if(shortcutItems.length > 0) {
        // Remove the last element and save it as key
        // the remaining shortcutItems are the modifiers:
        key = shortcutItems.pop();
        // Check if the key is a keycode:
        if(key.indexOf('VK') == 0) {
          keycode  = key;
          key = null;
        }
      }
      // Create a new shortcut object:
      this.shortcut[id] = this.shortcutFactory(shortcutItems, key, keycode);
    }
    return this.shortcut[id];
  },

  setShortcut: function(id, shortcut) {
    var stringData;
    if(shortcut) {
      stringData = shortcut.toString();
    } else {
      stringData = '';
    }
    // Save the shortcut as Unicode String in the preferences:
    this.autofillFormsPrefs.setComplexValue(
      id,
      Components.interfaces.nsISupportsString,
      this.getUnicodeString(stringData)
    );
  },

  updateShortcut: function(id) {
    if(this.shortcut == null) {
      this.shortcut = new Object();
    }
    // Setting the shortcut object to "null" will update it on the next getShortcut() call:
    this.shortcut[id] = null;

    // Get the keyboard shortcut elements:
    var modifiers = this.getShortcut(id).modifiers.join(' ');
    var key = this.getShortcut(id).key;
    var keycode = this.getShortcut(id).keycode;

    var domId = 'autofillForms' + id.replace(/shortcut/, 'Shortcut');
    var command = 'autofillForms' + id.replace(/shortcut/i, '');

    // Remove current key if existing:
    if(document.getElementById(domId)) {
      document.getElementById('mainKeyset').removeChild(
        document.getElementById(domId)
      );
    }

    // Check if keyboard shortcut is enabled:
    if(key || keycode) {
      // Create a key element:
      var keyNode = document.createElement('key');

      keyNode.setAttribute('id', domId);
      keyNode.setAttribute('command', command);

      // Set the key attributes from saved shortcut:
      keyNode.setAttribute('modifiers', modifiers);
      if(key) {
        keyNode.setAttribute('key', key);
      } else {
        keyNode.setAttribute('keycode', keycode);
      }

      // Add the key to the mainKeyset:
      document.getElementById('mainKeyset').appendChild(keyNode);
    }
  },

  getFormattedShortcut: function(shortcut) {
    var formattedShortcut = '';
    // Add the modifiers:
    for(var i=0; i < shortcut.modifiers.length; i++) {
      try {
        formattedShortcut += this.getStringBundle().getString(shortcut.modifiers[i]) + '+';
      } catch(e) {
        // Error in shortcut string, return empty String;
        return '';
      }
    }
    if(shortcut.key) {
      // Add the key:
      if(shortcut.key == ' ') {
        formattedShortcut += this.getStringBundle().getString('VK_SPACE');
      } else {
        formattedShortcut += shortcut.key;
      }
    } else if(shortcut.keycode) {
      // Add the keycode (instead of the key):
      try {
        formattedShortcut += this.getStringBundle().getString(shortcut.keycode);
      } catch(e) {
        formattedShortcut += shortcut.keycode.replace('VK_', '');
      }
    }
    return formattedShortcut;
  },

  replaceDynamicTags: function(fieldRuleValue) {
    // Replace all dynamic tags with the return values of their associated tag codes:
    for(var j=0; j<this.getDynamicTags().length; j++) {
      // Catch if the number of tags doesn't match the number of tag codes or if the tag code is invalid:
      try {
        var regExpObj = new RegExp(this.getDynamicTags()[j],'g');
        // We use eval() here without restrictions - the given tagCode must be trusted:
        // http://forums.mozillazine.org/viewtopic.php?f=48&t=537839&start=435
        fieldRuleValue = fieldRuleValue.replace(regExpObj, eval(this.getDynamicTagCodes()[j]));
      } catch(e) {
        this.log(e);
      }
    }
    return fieldRuleValue;
  },

  getDynamicTagsFile: function() {
    var file = this.getConfigDirectory();
    file.append('dynamicTags.txt');
    if(!file.exists()) {
      file.create(Components.interfaces.nsIFile.NORMAL_FILE_TYPE, 0660);
    }
    return file;
  },

  exportDynamicTagsToConfigDirectory: function() {
    var prefString;
    // Get the dynamicTags string from the preferences:
    prefString = this.autofillFormsPrefs
              .getComplexValue('dynamicTags',Components.interfaces.nsIPrefLocalizedString)
              .data;
    if(prefString) {
      this.setFileContent(this.getDynamicTagsFile(), prefString);
    }
  },

  importDynamicTagsFromConfigDirectory: function() {
    var prefString;
    prefString = this.getFileContent(this.getDynamicTagsFile());
    if(prefString) {
      // Store the dynamicTags as unicode string in the preferences:
      this.autofillFormsPrefs.setComplexValue(
        'dynamicTags',
        Components.interfaces.nsISupportsString,
        this.getUnicodeString(prefString)
      );
    }
  },

  getDynamicTags: function() {
    if(this.dynamicTags == null) {
      var prefString;
      if(this.autofillFormsPrefs.getBoolPref('useConfigDirectory')) {
        // Get the dynamicTags string from the dynamicTags file in the configDirectory:
        prefString = this.getFileContent(this.getDynamicTagsFile());
      }
      if(!prefString) {
        prefString = this.autofillFormsPrefs
                  .getComplexValue('dynamicTags',Components.interfaces.nsIPrefLocalizedString)
                  .data;
      }
      this.dynamicTags = prefString.split('\t');
    }
    return this.dynamicTags;
  },

  setDynamicTags: function(dynamicTags) {
    // Save the dynamic tags separated by tabs:
    var prefString = dynamicTags.join('\t');
    if(this.autofillFormsPrefs.getBoolPref('useConfigDirectory')) {
      this.setFileContent(this.getDynamicTagsFile(), prefString);
    } else {
      this.autofillFormsPrefs.setComplexValue(
        'dynamicTags',
        Components.interfaces.nsISupportsString,
        this.getUnicodeString(prefString)
      );
    }
  },

  getDynamicTagCodesFile: function() {
    var file = this.getConfigDirectory();
    file.append('dynamicTagCodes.txt');
    if(!file.exists()) {
      file.create(Components.interfaces.nsIFile.NORMAL_FILE_TYPE, 0660);
    }
    return file;
  },

  exportDynamicTagCodesToConfigDirectory: function() {
    var prefString;
    // Get the dynamicTagCodes string from the preferences:
    prefString = this.autofillFormsPrefs
              .getComplexValue('dynamicTagCodes',Components.interfaces.nsIPrefLocalizedString)
              .data;
    if(prefString) {
      this.setFileContent(this.getDynamicTagCodesFile(), prefString);
    }
  },

  importDynamicTagCodesFromConfigDirectory: function() {
    var prefString;
    prefString = this.getFileContent(this.getDynamicTagCodesFile());
    if(prefString) {
      // Store the dynamicTagCodes as unicode string in the preferences:
      this.autofillFormsPrefs.setComplexValue(
        'dynamicTagCodes',
        Components.interfaces.nsISupportsString,
        this.getUnicodeString(prefString)
      );
    }
  },

  getDynamicTagCodes: function() {
    if(this.dynamicTagCodes == null) {
      var prefString;
      if(this.autofillFormsPrefs.getBoolPref('useConfigDirectory')) {
        // Get the dynamicTagCodes string from the dynamicTagCodes file in the configDirectory:
        prefString = this.getFileContent(this.getDynamicTagCodesFile());
      }
      if(!prefString) {
        prefString = this.autofillFormsPrefs
                  .getComplexValue('dynamicTagCodes',Components.interfaces.nsIPrefLocalizedString)
                  .data;
      }
      this.dynamicTagCodes = prefString.split('\t');
    }
    return this.dynamicTagCodes;
  },

  setDynamicTagCodes: function(dynamicTagCodes) {
    // Save the dynamic tag codes separated by tabs:
    var prefString = dynamicTagCodes.join('\t');
    if(this.autofillFormsPrefs.getBoolPref('useConfigDirectory')) {
      this.setFileContent(this.getDynamicTagCodesFile(), prefString);
    } else {
      this.autofillFormsPrefs.setComplexValue(
      'dynamicTagCodes',
        Components.interfaces.nsISupportsString,
        this.getUnicodeString(prefString)
      );
    }
  },

  optionsInitialize: function() {
    // Save the reference to the Autofill Forms preferences branch:
    this.autofillFormsPrefs = this.getPrefManager().getBranch('extensions.autofillForms@blueimp.net.');

    // Initialize the profile lists:
    this.initProfilesLists();
    // Initialize the fieldRules tree:
    this.initTree();
    // Initialize the simple interface:
    this.initSimpleInterface();

    // Sort is to be ascending if clicked first:
    this.ascending = true;
    this.profilesAscending = true;

    var configDirectoryTextbox = document.getElementById('configDirectoryTextBox');
    if(configDirectoryTextbox && this.autofillFormsPrefs.prefHasUserValue('configDirectory')) {
      var configDirectory = this.getConfigDirectory();
      if(configDirectory) {
        configDirectoryTextbox.value = configDirectory.path;
      }
    }

    // Initialize the keyboard shortcut objects:
    this.shortcut = new Object();
    this.shortcut['shortcut'] = null;
    this.shortcut['shortcutSubmit'] = null;
    this.shortcut['shortcutAllTabs'] = null;
    this.shortcut['shortcutFromProfileSelection'] = null;
    this.shortcut['shortcutProfile'] = null;
    this.shortcut['shortcutSettings'] = null;
    this.shortcut['shortcutDisplayFormDetails'] = null;

    // Display the shortcut combinations:
    for(var property in this.shortcut) {
      if(document.getElementById(property)) {
        document.getElementById(property).value = this.getFormattedShortcut(this.getShortcut(property));
      }
    }

    // Initialize the mouse button objects:
    this.mouseButton = new Object();
    this.mouseButton['mouseShortcut'] = null;
    this.mouseButton['mouseShortcutSubmit'] = null;
    this.mouseButton['mouseShortcutAllTabs'] = null;
    this.mouseButton['mouseShortcutFromProfileSelection'] = null;
    this.mouseButton['mouseShortcutProfile'] = null;
    this.mouseButton['mouseShortcutSettings'] = null;
    this.mouseButton['mouseShortcutDisplayFormDetails'] = null;

    // Display the mouse button combinations:
    for(var property in this.mouseButton) {
      if(document.getElementById(property)) {
        document.getElementById(property).value = this.getFormattedMouseButton(this.getMouseButton(property));
      }
    }

    // Parse the window params (e.g. initializing the target form field values):
    this.parseOptionsWindowParams();
  },

  initSimpleInterface: function() {
    var rows = document.getElementById('simpleInterfaceRows');
    if(rows) {
      while(rows.hasChildNodes()) {
        rows.removeChild(rows.firstChild);
      }
      for(var i=0; i<this.getFieldRules().length; i++) {
        // Only show enabled fieldRules:
        if(!this.getFieldRules()[i]['fieldRuleEnabled']) {
          continue;
        }
        rows.appendChild(
          this.getSimpleInterfaceRow(
            i,
            this.getFieldRules()[i]['fieldRuleName'],
            this.getFieldRules()[i]['fieldRuleValue']
          )
        );
      }
    }
  },

  addSimpleInterfaceRow: function(index) {
    var row = this.getSimpleInterfaceRow(
            index,
            this.getFieldRules()[index]['fieldRuleName'],
            this.getFieldRules()[index]['fieldRuleValue']
          )
    var rows = document.getElementById('simpleInterfaceRows');
    if(rows) {
      var nextSibling;
      if(rows.childNodes) {
        for(var i=index+1; i<rows.childNodes.length; i++) {
          nextSibling = document.getElementById('simpleInterfaceRow_'+i);
          if(nextSibling) {
            rows.insertBefore(row, nextSibling);
            break;
          }
        }
      }
      if(!nextSibling) {
        rows.appendChild(row);
      }
    }
  },

  removeSimpleInterfaceRow: function(index) {
    var row = document.getElementById('simpleInterfaceRow_'+index);
    if(row) {
      row.parentNode.removeChild(row);
    }
  },

  getSimpleInterfaceRow: function(index, name, value) {
    if(!arguments.callee.row) {
      arguments.callee.row = document.createElement('row');
      arguments.callee.row.setAttribute('align', 'center');
      var label = document.createElement('label');
      var textbox = document.createElement('textbox');
      textbox.setAttribute('newlines', 'pasteintact');
      arguments.callee.row.appendChild(label);
      arguments.callee.row.appendChild(textbox);
    }
    var row = arguments.callee.row.cloneNode(true);
    row.setAttribute('id', 'simpleInterfaceRow_'+index);
    row.firstChild.setAttribute('value', name+':');
    row.firstChild.setAttribute('id', 'simpleInterfaceLabel_'+index);
    row.firstChild.setAttribute('control', 'simpleInterfaceTextbox_'+index);
    row.lastChild.setAttribute('id', 'simpleInterfaceTextbox_'+index);
    row.lastChild.setAttribute('value', value);
    row.lastChild.addEventListener('change', function (){
      autofillForms.applySimpleInterfaceValue(this);
    }, false);
    row.lastChild.addEventListener('input', function () {
      this.value = autofillForms.replaceControlCharacters(this.value);
    }, false);

    // Is textbox a password field?
    if(this.getRegExpPasswordLabel().test(name)) {
      row.lastChild.setAttribute('type', 'password');
    }
    return row;
  },

  applySimpleInterfaceValue: function(textBox) {
    // See method selectedFieldRule() why this has to be set to null:
    this.lastSelectedIndex = null;

    var index = parseInt(textBox.getAttribute('id').split('_')[1]);
    this.getFieldRules()[index]['fieldRuleValue'] = this.makeSafe(textBox.value);

    // Notify the tree (of the advanced interface):
    try {
      this.treeBox.invalidateRow(index);
    } catch(e) {
    }

    // Update the preferences:
    this.setFieldRules();
  },

  updateSimpleInterfaceRow: function(index) {
    var row = document.getElementById('simpleInterfaceRow_'+index);
    if(row) {
      row.firstChild.value = this.getFieldRules()[index]['fieldRuleName']+':';
      row.lastChild.value = this.getFieldRules()[index]['fieldRuleValue'];
      // Is textbox a password field?
      if(this.getRegExpPasswordLabel().test(this.getFieldRules()[index]['fieldRuleName'])) {
        row.lastChild.setAttribute('type', 'password');
      } else {
        row.lastChild.removeAttribute('type');
      }
    }
  },

  getFieldRuleNameForElement: function(element) {
    // Use the form field label as name if available:
    var labelValue = this.getLabelForElement(element);
    // Remove the colon, if present:
    if(labelValue && labelValue.charAt(labelValue.length-1) == ':') {
      labelValue = labelValue.substr(0, labelValue.length-1);
    }
    // If no label could be found, use the name or the id with the first character in upper case:
    if(!labelValue) {
      labelValue = element.name;
      if(!labelValue) {
        labelValue = element.id;
      }
      if(labelValue) {
        labelValue = labelValue.charAt(0).toUpperCase() + labelValue.substr(1);
      }
    }
    return labelValue;
  },

  getRegExpStrForValue: function(value) {
    try {
      // Remove unsave characters, escape regexp characters and return the regexp string:
      return this.getRegExpStr('(?:^'+this.escapeRegExp(this.makeSafe(value))+'$)');
    } catch(e) {
      // If an error occurs, return the safe value string.
      // If using it as regular expression fails a simple string comparison is used:
      return this.makeSafe(value);
    }
  },

  getFieldRuleForElement: function(element) {
    var name = element.name;
    // If no name is available use the label as fallback:
    if(!name) {
      name = this.getLabelForElement(element);
    }
    // If no name and no label is available use the id as fallback:
    if(!name) {
      name = element.id;
    }
    try {
      // Remove unsave characters, escape regexp characters and return the regexp string:
      return this.getRegExpStr('(?:^'+this.escapeRegExp(this.makeSafe(name))+'$)');
    } catch(e) {
      // If an error occurs, return an always matching regexp string:
      return '(?:)';
    }
  },

  getSiteRuleForURL: function(url) {
    try {
      // Remove unsave characters, escape regexp characters and return the regexp string:
      return this.getRegExpStr('(?:^'+this.escapeRegExp(this.makeSafe(url))+')');
    } catch(e) {
      // If an error occurs, return an always matching regexp string:
      return '(?:)';
    }
  },

  parseOptionsWindowParams: function() {
    // Check the windows arguments:
    if(window.arguments && window.arguments[0]) {
      if(window.arguments[0].targetFormField) {
        var formFieldObject = window.arguments[0].targetFormField;

        var value;
        switch(formFieldObject.type) {
          case 'checkbox':
          case 'radio':
          case 'select-one':
          case 'select-multiple':
            value = this.getRegExpStrForValue(formFieldObject.value);
            break;
          default:
            value = this.replaceControlCharacters(formFieldObject.value);
            break;
        }

        var location = this.getDoc().location;

        // Reset the targetFormField of the autofillForms object referenced by window.arguments[0]:
        window.arguments[0].targetFormField = null;

        // Set the textbox values using the form field properties and the current document location:
        document.getElementById('fieldRuleNameTextBox').value
          = this.getFieldRuleNameForElement(formFieldObject)
          + (location.hostname ? ' - ' + location.hostname : '');
        document.getElementById('fieldRuleValueTextBox').value = value;
        document.getElementById('fieldRuleFieldRuleTextBox').value
          = this.getFieldRuleForElement(formFieldObject);
        document.getElementById('fieldRuleSiteRuleTextBox').value
          = this.getSiteRuleForURL(location.protocol + '//' + location.host);

        // Make sure the main pane is selected:
        document.getElementById('autofillFormsPrefs').showPane(
          document.getElementById('autofillFormsPrefPaneMain')
        );

        // Set the focus to the name field:
        //document.getElementById('fieldRuleNameTextBox').focus();
        autofillForms.action(document.getElementById('fieldRuleNameTextBox'), 'focus');
      } else if(window.arguments[0].newProfileFromForm) {
        // Make sure the main pane is selected:
        document.getElementById('autofillFormsPrefs').showPane(
          document.getElementById('autofillFormsPrefPaneMain')
        );
      }
    }
  },

  optionsFinalize: function() {
  },

  showProfileSwitcher: function() {
    if(this.autofillFormsPrefs.getBoolPref('useConfigDirectory')) {
      // Always retrieve the profile labels from file if useConfigDirectory is enabled:
      this.profileLabels = null;
    }
    // The nsIPromptService select() method doesn't offer to set a preselection,
    // so we switch the current profile label with the first item (which is selected by default):
    var list;
    var currentIndex = this.getProfileIndex();
    if(currentIndex != 0) {
      // Copy the profilLabels array (so we don't change the original):
      list = new Array().concat(this.getProfileLabels());
      // Switch the current profile label with the first item:
      var tmp = list[0];
      list[0] = list[currentIndex];
      list[currentIndex] = tmp;
    } else {
      // Set the list to the profilLabels reference if it is not to be changed:
      list = this.getProfileLabels();
    }
    var selected = {};
    // Show the selection prompt:
    var ok = this.getPrompts().select(
      window,
      this.getStringBundle().getString('profileSelectionWindowTitle'),
      this.getStringBundle().getString('profileSelectionPrompt'),
      list.length,
      list,
      selected
    );
    if(ok) {
      // If nothing changed, return:
      if(selected.value == 0)
        return;
      // If the currentIndex has been selected and is not 0, it is in fact the index 0:
      if(currentIndex != 0 && selected.value == currentIndex)
        selected.value = 0;
      // Set the profile index to the selected one:
      this.setProfileIndex(selected.value)
    }
  },

  showDialog: function(url, params) {
    if (this.currentDialogs == null) {
      this.currentDialogs = new Object();
    }

    // Is the window already
    var win = this.currentDialogs[url];
    if (win == null || win.closed)
    {
      var paramObject = params ? params : this;
      win = window.openDialog(
        url,
        '',
        'chrome=yes,resizable=yes,toolbar=yes,centerscreen=yes,modal=no,dependent=no,dialog=no',
        paramObject
      );

      this.currentDialogs[url] = win;
      return win;
    } else {
      win.focus();
    }
  },

  inArray: function(array, item) {
    var i = array.length;
    while(i--)
      if(array[i] === item)
        return true;
    return false;
  },

  displayFormDetails: function() {
    this.searchAndDisplayFormDetails(this.getWin());
  },

  searchAndDisplayFormDetails: function(win) {
    win = win ? win : this.getWin();

    var doc = this.getDoc(win);

    // Check if any web forms are available on the current window:
    if(doc && doc.forms && doc.forms.length > 0) {

       // Go through the forms:
       for(var i = 0; i < doc.forms.length; i++) {

        // The form elements list:
        var elements = doc.forms[i].elements;

        // Go through the form elements:
        for(var j = 0; j < elements.length; j++) {
          this.displayFormElementDetails(elements[j], j, i, doc);
        }
      }
    }

    // Recursive call for all subframes:
    for(var f=0; f < win.frames.length; f++) {
      this.searchAndDisplayFormDetails(win.frames[f]);
    }
  },

  isValidFormField: function(element) {
    // ignore disabled (and return false) only if 'ignore disabled fields' is ticked
    if(element.disabled && this.autofillFormsPrefs.getBoolPref('ignoreDisabledFields')) {
      return false;
    }
    if(!arguments.callee.regExpFormFieldType) {
      arguments.callee.regExpFormFieldType = new RegExp(
        this.autofillFormsPrefs.getCharPref('regExpFormFieldTypes')
      );
    }
    return arguments.callee.regExpFormFieldType.test(element.type);
  },

  displayFormElementDetails: function(element, elementNumber, formNumber, doc) {
    // Create a unique id for the form element:
    var id = 'autofillForms-f' + formNumber + '-e' + elementNumber;

    // Remove the form details node if already present
    // (nodeType 1 is an element node):
    if(element.nextSibling && element.nextSibling.nodeType == 1 && element.nextSibling.getAttribute('id') == id) {
      element.parentNode.removeChild(element.nextSibling);
      return;
    }

    // Only display valid form fields:
    if(this.isValidFormField(element)) {
      // Create a "span" node with element details:
      var text;
      // Display the element name if available, else the element id if available, else an empty name:
      if(element.name || !element.id) {
        text = 'name="' + element.name;
      } else {
        text = 'id="' + element.id;
      }
      // Display the element value:
      text += '" value="' +  element.value + '"';
      var span = doc.createElement('span');
      span.setAttribute('id', id);
      span.setAttribute('style', this.autofillFormsPrefs.getCharPref('formDetailsStyle'));
      span.setAttribute('title', text);
      span.appendChild(doc.createTextNode(text));

      // Insert the form details node after the element:
      if(element.nextSibling)
        element.parentNode.insertBefore(span, element.nextSibling);
      else
        element.parentNode.appendChild(span);
    }
  },

  ruleEditorInitialize: function() {
    // Save the reference to the Autofill Forms preferences branch:
    this.autofillFormsPrefs = this.getPrefManager().getBranch('extensions.autofillForms@blueimp.net.');

    if(window.arguments && window.arguments[0] && window.arguments[0].attributes) {
      this.currentRuleField = window.arguments[0];
    }

    // Initialize the ruleElementTypes:
    this.ruleElementTypes = new Array();
    this.ruleElementTypes.push('contains');
    this.ruleElementTypes.push('beginsWith');
    this.ruleElementTypes.push('endsWith');
    this.ruleElementTypes.push('equals');

    // If the rule editor is used to edit the site rule, add two predefined protocol rules:
    if(this.currentRuleField && this.currentRuleField.id && this.currentRuleField.id.indexOf('SiteRule') != -1) {
      this.ruleEditorAdd('beginsWith', 'http:\/\/');
      this.ruleEditorAdd('beginsWith', 'https:\/\/');
    } else {
      this.ruleEditorAdd();
    }
  },

  ruleEditorSave: function() {
    if(document.getElementById('ruleElementsList')) {
      var str = '';
      var richlistbox = document.getElementById('ruleElementsList');
      var richlistitems = richlistbox.getElementsByTagName('richlistitem');
      var menulists,textboxes;

      // Go through the richlistbox items:
      for(var i=0; i<richlistitems.length; i++) {
        // Link the conditions as disjunctions (OR-Relations);
        if(str.length != 0)
          str += '|';
        menulists = richlistitems[i].getElementsByTagName('menulist');
        textboxes = richlistitems[i].getElementsByTagName('textbox');

        // Add the current condition to the string:
        switch(menulists[0].selectedItem.value) {
          case 'contains':
            str += '(?:' + textboxes[0].value + ')';
            break;
          case 'beginsWith':
            str += '(?:^' + textboxes[0].value + ')';
            break;
          case 'endsWith':
            str += '(?:' + textboxes[0].value + '$)';
            break;
          case 'equals':
            str += '(?:^' + textboxes[0].value + '$)';
            break;
        }
      }
      if(this.currentRuleField) {
        // Set the current field value to the created string:
        this.currentRuleField.value = str;
        // Call the onchange handler:
        if(this.currentRuleField.onchange) {
          //this.currentRuleField.onchange();
          autofillForms.action(this.currentRuleField, 'change');
        }
        // Call the focus handler:
        if(this.currentRuleField.focus) {
          //this.currentRuleField.focus();
          autofillForms.action(this.currentRuleField, 'focus');
        }
      }
    }
    return true;
  },

  ruleEditorAdd: function(type, ruleElement) {
    if(document.getElementById('ruleElementsList')) {
      var richlistbox = document.getElementById('ruleElementsList');

      var richlistitem,menulist,menupopup,menuitem,textbox,label;

      richlistitem = document.createElement('richlistitem');

      // Create the condition type menu:
      menulist = document.createElement('menulist');
      menupopup = document.createElement('menupopup');

      var selectedIndex = 0;

      // Create the menu of ruleElementTypes:
      for(var i=0; i<this.ruleElementTypes.length; i++) {
        menuitem = document.createElement('menuitem');
        menuitem.setAttribute(
          'value',
          this.ruleElementTypes[i]
        );
        menuitem.setAttribute(
          'label',
          this.getStringBundle().getString(this.ruleElementTypes[i] + 'RuleType')
        );
        menupopup.appendChild(menuitem);

        // Set the selectedIndex:
        if(type != null && type == this.ruleElementTypes[i])
          selectedIndex = i;
      }

      menulist.appendChild(menupopup);
      richlistitem.appendChild(menulist);

      // Create the textbox:
      textbox = document.createElement('textbox');
      if(ruleElement != null)
        textbox.setAttribute('value',ruleElement);
      textbox.setAttribute('flex','1');
      richlistitem.appendChild(textbox);

      richlistbox.appendChild(richlistitem);

      // Select the menuitem:
      menulist.selectedIndex = selectedIndex;
    }
  },

  ruleEditorRemove: function(index) {
    var ruleElementsList = document.getElementById('ruleElementsList');
    if(ruleElementsList) {
      if(this.autofillFormsPrefs.getBoolPref('enableConfirmationDialogs')) {
        // Confirmation dialog:
        if(!this.getPrompts().confirm(
            null,
            this.getStringBundle().getString('removeRuleConditionTitle'),
            this.getStringBundle().getString('removeRuleConditionText')
          )
        ) {
          return;
        }
      }

      var richlistbox = ruleElementsList;
      if(index)
        richlistbox.selectedIndex = index;
      if(richlistbox.selectedItem && richlistbox.selectedIndex != -1)
        richlistbox.removeChild(richlistbox.selectedItem);
    }
  },

  ruleEditorIsTextBoxFocused: function() {
    return this.ruleEditorTextBoxFocused;
  },

  ruleEditorFocus: function() {
    var focusedElement = document.commandDispatcher.focusedElement;

    // Monitor if a textbox is focused:
    if(!this.ruleEditorTextBoxFocused && focusedElement && focusedElement.tagName == 'html:input') {
      this.ruleEditorTextBoxFocused = true;
    } else if(this.ruleEditorTextBoxFocused && focusedElement && focusedElement.tagName == 'richlistbox') {
      this.ruleEditorTextBoxFocused = false;
    }
  },

  ruleEditorHandleKeyPress: function(event) {
    // Only remove a dynamic tag on delete key press if no textbox is focused:
    if(event.keyCode == 46 && !this.ruleEditorIsTextBoxFocused()) {
      this.ruleEditorRemove();
    }
  },

  ruleEditorFinalize: function() {
    this.currentRuleField = null;
  },

  tagEditorInitialize: function() {
    // Save the reference to the Autofill Forms preferences branch:
    this.autofillFormsPrefs = this.getPrefManager().getBranch('extensions.autofillForms@blueimp.net.');

    // Add existing tags to the list:
    for(var i=0; i<this.getDynamicTags().length; i++) {
      // Catch if the number of tags doesn't match the number of tag codes:
      try {
        this.tagEditorAdd(this.getDynamicTags()[i],this.getDynamicTagCodes()[i])
      } catch(e) {
        this.log(e);
      }
    }
  },

  tagEditorSave: function() {
    var richlistbox = document.getElementById('tagList');
    if(richlistbox) {
      var richlistitems = richlistbox.getElementsByTagName('richlistitem');
      var textboxes;

      var dynamicTags = new Array();
      var dynamicTagCodes = new Array();

      // Go through the richlistbox items:
      for(var i=0; i<richlistitems.length; i++) {
        textboxes = richlistitems[i].getElementsByTagName('textbox');

        // Add the dynamic tags and their associated tag codes to the lists:
        if (textboxes[0].value != '' && textboxes[1].value != '') {
          dynamicTags.push(this.makeSafe(textboxes[0].value));
          dynamicTagCodes.push(this.makeSafe(textboxes[1].value));
        }
      }
      // Save the lists in the preferences:
      this.setDynamicTags(dynamicTags);
      this.setDynamicTagCodes(dynamicTagCodes);
    }
    return true;
  },

  tagEditorAdd: function(tag, tagCode) {
    var richlistbox = document.getElementById('tagList');
    if(richlistbox) {
      var richlistitem,textbox;

      richlistitem = document.createElement('richlistitem');

      // Create the tag textbox:
      textbox = document.createElement('textbox');
      textbox.setAttribute('class','tag');
      if(tag != null)
        textbox.setAttribute('value',tag);
      richlistitem.appendChild(textbox);

      // Create the tagCode textbox:
      textbox = document.createElement('textbox');
      textbox.setAttribute('class','tagCode');
      textbox.setAttribute('flex','1');
      if(tagCode != null)
        textbox.setAttribute('value',tagCode);
      richlistitem.appendChild(textbox);

      richlistbox.appendChild(richlistitem);
    }
  },

  tagEditorRemove: function(index) {
    var richlistbox = document.getElementById('tagList');
    if(richlistbox) {
      if(this.autofillFormsPrefs.getBoolPref('enableConfirmationDialogs')) {
        // Confirmation dialog:
        if(!this.getPrompts().confirm(
            null,
            this.getStringBundle().getString('removeDynamicTagTitle'),
            this.getStringBundle().getString('removeDynamicTagText')
          )
        ) {
          return;
        }
      }
      if(index)
        richlistbox.selectedIndex = index;
      if(richlistbox.selectedItem && richlistbox.selectedIndex != -1)
      {
        richlistbox.removeChild(richlistbox.selectedItem);
      }
    }
  },

  tagEditorValidate: function(index) {
    var richlistbox = document.getElementById('tagList');
    if(richlistbox) {
      if(index)
        richlistbox.selectedIndex = index;
      if(richlistbox.selectedItem) {
        var tagCode = richlistbox.selectedItem.lastChild.value;
        var validationResultTextBox = document.getElementById('validationResultTextBox');
        try {
          validationResultTextBox.removeAttribute('style');
          // We use eval() here without restrictions - the given tagCode must be trusted:
          // http://forums.mozillazine.org/viewtopic.php?f=48&t=537839&start=435
          validationResultTextBox.value = eval(tagCode);
        } catch(e) {
          validationResultTextBox.setAttribute('style', 'color:red;');
          validationResultTextBox.value = e;
        }
      }
    }
  },

  tagEditorIsTextBoxFocused: function() {
    return this.tagEditorTextBoxFocused;
  },

  tagEditorFocus: function() {
    var focusedElement = document.commandDispatcher.focusedElement;

    // Monitor if a textbox is focused:
    if(!this.tagEditorTextBoxFocused && focusedElement && focusedElement.tagName == 'html:input') {
      this.tagEditorTextBoxFocused = true;
    } else if(this.tagEditorTextBoxFocused && focusedElement && focusedElement.tagName == 'richlistbox') {
      this.tagEditorTextBoxFocused = false;
    }
  },

  tagEditorHandleKeyPress: function(event) {
    // Only remove a dynamic tag on delete key press if no textbox is focused:
    if(event.keyCode == 46 && !this.tagEditorIsTextBoxFocused()) {
      this.tagEditorRemove();
    }
  },

  tagEditorFinalize: function() {
  },

  openHelp: function(topic) {
    if(!topic) {
      topic = '';
    }
    var url = this.autofillFormsPrefs.getCharPref('helpURL').replace(/\[TOPIC\]$/, topic);
    this.openNewTab(url, true);
  },

  openNewTab: function(url, focus) {
    var helpTab = this.getBrowser().addTab(url);
    if(focus) {
      this.getBrowser().selectedTab = helpTab;
      this.getWindowMediator().getMostRecentWindow('navigator:browser').focus();
    }
  },

  addLeadingZeros: function(number, length) {
    number = number.toString();
    while(number.length < length) {
      number = '0'+number;
    }
    return number;
  },

  escapeRegExp: function(str) {
    if (!arguments.callee.regExp) {
      var specials = new Array(
        '^', '$', '*', '+', '?', '.', '|', '/',
        '(', ')', '[', ']', '{', '}', '\\'
      );
      arguments.callee.regExp = new RegExp(
        '(\\' + specials.join('|\\') + ')', 'g'
      );
    }
    return str.replace(arguments.callee.regExp, '\\$1');
  },

  getClipboardText: function() {
    var clipboardText = null;
    var clip  = Components.classes['@mozilla.org/widget/clipboard;1']
            .getService(Components.interfaces.nsIClipboard);
    if(!clip) {
      return null;
    }

    var trans = Components.classes['@mozilla.org/widget/transferable;1']
            .createInstance(Components.interfaces.nsITransferable);
    if(!trans) {
      return null;
    }

    trans.addDataFlavor('text/unicode');

    clip.getData(trans, clip.kGlobalClipboard);

    var str     = new Object();
    var strLength = new Object();

    trans.getTransferData('text/unicode', str, strLength);

    if(str) {
      str = str.value.QueryInterface(Components.interfaces.nsISupportsString);
    }
    if(str) {
      clipboardText = str.data.substring(0, strLength.value / 2);
    }

    return clipboardText
  },

  getMasterSecurityDevice: function() {
    return Components.classes['@mozilla.org/security/pk11tokendb;1']
        .getService(Components.interfaces.nsIPK11TokenDB);
  },

  log: function(aMessage, aSourceName, aSourceLine, aLineNumber, aColumnNumber, aFlags, aCategory) {
    var consoleService = Components.classes['@mozilla.org/consoleservice;1']
      .getService(Components.interfaces.nsIConsoleService);
    if(aSourceName != 'undefined') {
      var scriptError = Components.classes["@mozilla.org/scripterror;1"]
        .createInstance(Components.interfaces.nsIScriptError);
      scriptError.init(
        aMessage,
        aSourceName,
        aSourceLine,
        aLineNumber,
        aColumnNumber,
        aFlags,
        aCategory
      );
      consoleService.logMessage(scriptError);
    } else {
      consoleService.logStringMessage(aMessage);
    }
  },

  finalizeToolbarButtonStatus: function() {
    var autofillFormsButton = document.getElementById('autofillFormsButton');
    var hideToolbarButton = this.autofillFormsPrefs.getBoolPref('hideToolbarButton');
    if(!autofillFormsButton && !hideToolbarButton) {
      // If the toolbar button icon has been removed from the toolbar by drag&drop
      // enable the hideToolbarButton setting:
      this.autofillFormsPrefs.setBoolPref('hideToolbarButton', true);
    } else if(autofillFormsButton && !autofillFormsButton.getAttribute('hidden')) {
      // If the toolbar button icon has been added to the toolbar by drag&drop
      // disable the hideToolbarButton setting:
      this.autofillFormsPrefs.setBoolPref('hideToolbarButton', false);
    }
  },

  finalize: function() {
    this.finalizeToolbarButtonStatus();

    // Remove the content area context menu listener:
    var contentAreaContextMenu = document.getElementById('contentAreaContextMenu');
    if(contentAreaContextMenu) {
      contentAreaContextMenu.removeEventListener(
        'popupshowing',
        this.contentAreaContextMenuEventListener,
        false
      );
    }

    // Remove the preferences Observer:
    this.autofillFormsPrefs.removeObserver('', this);
  }

}
