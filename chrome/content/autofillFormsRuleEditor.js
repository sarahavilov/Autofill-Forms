/*
 * @package autofillForms
 * @author Sebastian Tschan
 * @copyright (c) Sebastian Tschan
 * @license GNU General Public License
 * @link https://blueimp.net/mozilla/
 */

window.addEventListener('load', function() { autofillForms.ruleEditorInitialize(); }, false);
window.addEventListener('unload', function() { autofillForms.ruleEditorFinalize(); }, false);
window.addEventListener('focus', function() { autofillForms.ruleEditorFocus(); }, true);
