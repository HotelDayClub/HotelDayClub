const { esc, money } = require('./util');

// Checkout decision point: step numbers, the disabled-button reason,
// and which fields may be remembered. Consent ticks are never stored.
class CheckoutFlow {
  static requiredTicks() {
    return ['accept'];
  }

  static consentTicks() {
    return ['accept', 'marketing'];
  }

  static reason(remaining, placement) {
    const n = Math.max(0, Math.floor(Number(remaining) || 0));
    if (n <= 0) return '';
    const where = placement === 'aside' || placement === 'dock' ? 'terms box' : 'box above';
    if (n === 1) return `Tick the ${where} to continue.`;
    return `Tick the ${n} boxes above to continue.`;
  }

  static steps(hasExtras) {
    let n = 1;
    const details = n++;
    const arrival = n++;
    const extras = hasExtras ? n++ : 0;
    const payment = n++;
    const before = n++;
    return { details, arrival, extras, payment, before };
  }

  static changeLink(href, what) {
    const label = `Change ${what}`;
    return `<a class="co-change" href="${esc(href)}" aria-label="${esc(label)}">Change</a>`;
  }

  static extraValue(addons) {
    const rows = addons || [];
    if (!rows.length) return 'None';
    return rows.map(ad => `${ad.name} × ${ad.qty} · ${money(ad.line)} (demo)`).join(', ');
  }

  static extraHtml(addons) {
    const rows = addons || [];
    if (!rows.length) return 'None';
    return rows.map(ad => `${esc(ad.name)} × ${ad.qty} · <span class="co-nowrap">${esc(money(ad.line))} (demo)</span>`).join(', ');
  }

  static clearFunction() {
    return `function clearCheckoutMemory(){
  try{
    var drop=[];
    for(var i=0;i<sessionStorage.length;i++){
      var key=sessionStorage.key(i);
      if(key&&key.indexOf('hdc-checkout:')===0) drop.push(key);
    }
    drop.forEach(function(key){sessionStorage.removeItem(key);});
  }catch(err){}
}`;
  }

  static storageApi() {
    return `${this.clearFunction()}
function checkoutPayload(form){
  var addon=[];
  form.querySelectorAll('input[name=addon]:checked').forEach(function(i){addon.push(i.value);});
  return {name:form.name.value,email:form.email.value,phone:form.phone.value,arrival:form.arrival?form.arrival.value:'',addon:addon};
}
function applyCheckoutMemory(form, saved){
  if(!saved) return;
  if(saved.name) form.name.value=saved.name;
  if(saved.email) form.email.value=saved.email;
  if(saved.phone) form.phone.value=saved.phone;
  if(saved.arrival && form.arrival){
    var opt=form.arrival.querySelector('option[value="'+String(saved.arrival).replace(/"/g,'')+'"]');
    if(opt) form.arrival.value=saved.arrival;
  }
  (saved.addon||[]).forEach(function(code){
    var box=form.querySelector('input[name=addon][value="'+String(code).replace(/"/g,'')+'"]');
    if(box && !box.disabled) box.checked=true;
  });
}
function checkoutReason(n){
  n=Math.max(0, n|0);
  if(n<=0) return '';
  if(n===1) return 'Tick the box above to continue.';
  return 'Tick the '+n+' boxes above to continue.';
}`;
  }

  static confirmControl({ id, reasonId, label, remaining, full, placement }) {
    const left = Math.max(0, Math.floor(Number(remaining) || 0));
    const reason = this.reason(left, placement || (String(id || '').includes('aside') ? 'aside' : String(id || '').includes('dock') ? 'dock' : 'form'));
    const gate = left > 0 ? ' aria-disabled="true"' : '';
    const described = left > 0 ? ` aria-describedby="${reasonId}"` : '';
    const hidden = left > 0 ? '' : ' hidden';
    const wide = full ? ' full' : '';
    return `<button class="btn btn-coral co-btn${wide}" id="${esc(id)}" type="submit" form="co-form"${gate} data-reason="${esc(reasonId)}"${described}>${esc(label)}</button><p class="co-reason" id="${esc(reasonId)}"${hidden}>${esc(reason)}</p>`;
  }
}

module.exports = { CheckoutFlow };
