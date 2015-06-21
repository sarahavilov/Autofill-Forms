/*
 * @package autofillForms
 * @author Sebastian Tschan
 * @copyright (c) Sebastian Tschan
 * @license GNU General Public License
 * @link https://blueimp.net/mozilla/
 */

window.addEventListener('load', function() { autofillForms.tagEditorInitialize(); }, false);
window.addEventListener('unload', function() { autofillForms.tagEditorFinalize(); }, false);
window.addEventListener('focus', function() { autofillForms.tagEditorFocus(); }, true);
