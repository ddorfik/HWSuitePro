/* Öffentliches Anfrageformular – ohne Anmeldung */
const token = location.pathname.split('/').filter(Boolean).pop();
const body = document.getElementById('body');

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

function formHtml() {
  return `
    <form id="lead-form" class="form-grid" novalidate>
      <div class="field">
        <label for="name">Name *</label>
        <input id="name" name="name" autocomplete="name" required maxlength="160" />
      </div>
      <div class="field">
        <label for="company">Firma (optional)</label>
        <input id="company" name="company" autocomplete="organization" maxlength="160" />
      </div>
      <div class="row">
        <div class="field">
          <label for="email">E-Mail</label>
          <input id="email" name="email" type="email" autocomplete="email" maxlength="160" />
        </div>
        <div class="field">
          <label for="phone">Telefon</label>
          <input id="phone" name="phone" type="tel" autocomplete="tel" maxlength="60" />
        </div>
      </div>
      <div class="field">
        <label for="message">Ihr Anliegen *</label>
        <textarea id="message" name="message" required maxlength="4000"
          placeholder="Was können wir für Sie tun? Bitte kurz beschreiben – z. B. Heizung defekt, Bad sanieren, Wartung."></textarea>
      </div>
      <div class="hint">Bitte geben Sie E-Mail oder Telefon an, damit wir Sie erreichen können.</div>
      <button type="submit" id="submit">Anfrage senden</button>
    </form>`;
}

function successHtml(result) {
  const name = result?.name ? `, ${esc(result.name)}` : '';
  return `<div class="state ok"><strong>Vielen Dank${name}!</strong>
    Ihre Anfrage ist bei uns eingegangen. Wir melden uns schnellstmöglich bei Ihnen.
    </div>
    <div class="hint">Falls es dringend ist, rufen Sie uns bitte direkt an.</div>`;
}

function renderForm() {
  body.innerHTML = formHtml();
  const form = document.getElementById('lead-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const submit = document.getElementById('submit');
    submit.disabled = true;
    submit.textContent = 'Wird gesendet …';
    try {
      const response = await fetch(`/api/public/leads/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.elements.name.value,
          company: form.elements.company.value,
          email: form.elements.email.value,
          phone: form.elements.phone.value,
          message: form.elements.message.value,
          source: 'website',
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Die Anfrage konnte nicht gesendet werden.');
      body.innerHTML = successHtml(data);
    } catch (error) {
      submit.disabled = false;
      submit.textContent = 'Anfrage senden';
      const box = document.createElement('div');
      box.className = 'state error';
      box.innerHTML = `<strong>Das hat nicht geklappt</strong>${esc(error.message)}`;
      form.before(box);
    }
  });
}

async function load() {
  if (!token) {
    body.innerHTML = '<div class="state error"><strong>Dieser Link ist ungültig</strong>Bitte wenden Sie sich direkt an uns.</div>';
    return;
  }
  renderForm();
}

load();
