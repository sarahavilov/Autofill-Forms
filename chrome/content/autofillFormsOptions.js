/*
 * @package autofillForms
 * @author Sebastian Tschan
 * @copyright (c) Sebastian Tschan
 * @license GNU General Public License
 * @link https://blueimp.net/mozilla/
 */

var {Services} = Components.utils.import("resource://gre/modules/Services.jsm");
(function (os) {
  var bp = autofillForms.getPrefManager().getBranch('browser.preferences.');
  var p = bp.getBoolPref('animateFadeIn');
  window.addEventListener('load', function() {
    if (os === 'Darwin') {
      bp.setBoolPref('animateFadeIn', false);
    }
    autofillForms.optionsInitialize();
  }, false);
  window.addEventListener('unload', function() {
    if (os === 'Darwin') {
      bp.setBoolPref('animateFadeIn', p);
    }
    autofillForms.optionsFinalize();
  }, false);
})(Services.appinfo.OS);
