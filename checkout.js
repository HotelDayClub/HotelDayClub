const { esc } = require('./util');

// Checkout decision point: step numbers, the disabled-button reason,
// and which fields may be remembered. Consent ticks are never stored.
class CheckoutFlow {
  static requiredTicks() {
    return ['risk', 'rules', 'group', 'terms', 'share'];
  }

  static consentTicks() {
    return ['risk', 'rules', 'group', 'terms', 'share', 'marketing'];
  }

  static reason(remaining) {
    const n = Math.max(0, Math.floor(Number(remaining) || 0));
    if (n <= 0) return '';
    if (n === 1) return 'Tick the box above to continue.';
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
    return `<a class="co-change" href="${esc(href)}">Change<span class="sr-only"> ${esc(what)}</span></a>`;
  }

  // Waiting on Legal. The hook is in the page and must render nothing.
  static riskSlot() {
    return '<div id="co-risk-slot" hidden></div>';
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

  static confirmControl({ id, reasonId, label, remaining, full }) {
    const left = Math.max(0, Math.floor(Number(remaining) || 0));
    const reason = this.reason(left);
    const gate = left > 0 ? ' aria-disabled="true"' : '';
    const described = left > 0 ? ` aria-describedby="${reasonId}"` : '';
    const hidden = left > 0 ? '' : ' hidden';
    const wide = full ? ' full' : '';
    return `<button class="btn btn-coral co-btn${wide}" id="${esc(id)}" type="submit" form="co-form"${gate} data-reason="${esc(reasonId)}"${described}>${esc(label)}</button><p class="co-reason" id="${esc(reasonId)}"${hidden}>${esc(reason)}</p>`;
  }
}

module.exports = { CheckoutFlow };
