/* Öffentliche Terminbestätigung – ohne App-Hülle */
const token = location.pathname.split('/').filter(Boolean).pop();
const body = document.getElementById('body');
const headline = document.getElementById('headline');
const kicker = document.getElementById('kicker');
const footer = document.getElementById('footer');
const brandName = document.getElementById('brand-name');

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

const dayNames = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const fmtDate = (value) => new Date(value).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtTime = (value) => new Date(value).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const fmtDay = (value) => dayNames[new Date(value).getDay()];

async function request(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Unbekannter Fehler');
  return data;
}

function addressLine(address) {
  const parts = [address.street, [address.zip, address.city].filter(Boolean).join(' ')].filter(Boolean);
  return parts.join(', ') || '–';
}

function detailRows(data) {
  return `
    <dl>
      <dt>Termin</dt><dd>${esc(data.appointment.title)}</dd>
      <dt>Kunde</dt><dd>${esc(data.customer.name || '–')}</dd>
      <dt>Adresse</dt><dd>${esc(addressLine(data.address))}</dd>
      <dt>Monteur</dt><dd>${esc(data.employee.name || 'wird noch festgelegt')}</dd>
      ${data.order ? `<dt>Vorgang</dt><dd>${esc(data.order.number)}</dd>` : ''}
    </dl>`;
}

function statusBox(data) {
  const { confirmed_at: confirmed, declined_at: declined, customer_reply: reply } = data.appointment;
  if (confirmed) {
    return `<div class="state ok"><strong>Termin bestätigt</strong>
      Vielen Dank! Wir sind am ${esc(fmtDate(data.appointment.start_at))} um ${esc(fmtTime(data.appointment.start_at))} Uhr bei Ihnen.
      Bestätigt am ${esc(fmtDate(confirmed))}.</div>`;
  }
  if (declined) {
    return `<div class="state warn"><strong>Termin abgelehnt</strong>
      Sie haben uns mitgeteilt, dass dieser Termin nicht passt${reply ? `: „${esc(reply)}“` : ''}.
      Wir melden uns, um einen neuen Termin zu finden.</div>`;
  }
  return '';
}

function contactBlock(data) {
  const company = data.company || {};
  return `<div class="contact">
    ${company.name ? `<div><strong>${esc(company.name)}</strong></div>` : ''}
    ${company.phone ? `<div>Telefon: <a href="tel:${esc(String(company.phone).replace(/[^+\d]/g, ''))}">${esc(company.phone)}</a></div>` : ''}
    ${company.email ? `<div>E-Mail: <a href="mailto:${esc(company.email)}">${esc(company.email)}</a></div>` : ''}
  </div>`;
}

function render(data) {
  const appointment = data.appointment;
  const company = data.company || {};
  if (company.name) {
    brandName.textContent = company.name;
    document.title = `Termin bestätigen · ${company.name}`;
  }
  headline.textContent = `${fmtDay(appointment.start_at)}, ${fmtDate(appointment.start_at)}`;
  kicker.textContent = appointment.confirmed_at ? 'Terminbestätigung' : 'Ihr Termin';

  const open = !appointment.confirmed_at && !appointment.declined_at;
  const actions = open
    ? `<div class="actions">
        <button class="btn-primary" id="confirm">Termin bestätigen</button>
        <button class="btn-ghost" id="decline-toggle">Termin passt nicht</button>
        <div id="decline-area" class="hidden">
          <textarea id="decline-text" maxlength="500" placeholder="Optional: Grund oder Wunschtermin (z. B. „bitte nachmittags“)"></textarea>
          <div class="actions">
            <button class="btn-primary" id="decline-send">Rückmeldung senden</button>
          </div>
        </div>
      </div>`
    : `<div class="actions">
        <button class="btn-ghost" id="change">${appointment.confirmed_at ? 'Termin passt doch nicht' : 'Doch bestätigen'}</button>
      </div>`;

  body.innerHTML = `
    <div class="when">
      <div>
        <div class="date">${esc(fmtDate(appointment.start_at))}</div>
        <div class="time">${esc(fmtTime(appointment.start_at))} – ${esc(fmtTime(appointment.end_at))} Uhr</div>
      </div>
      <div class="dow">${esc(fmtDay(appointment.start_at))}</div>
    </div>
    ${statusBox(data)}
    ${detailRows(data)}
    ${open ? `<div class="hint">Bitte bestätigen Sie den Termin kurz – dann weiß unser Team, dass alles passt.</div>` : ''}
    ${actions}
    ${contactBlock(data)}
  `;

  const run = async (button, path, payload) => {
    button.disabled = true;
    const label = button.textContent;
    button.textContent = 'Wird gesendet …';
    try {
      const updated = await request(`/api/public/appointments/${token}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
      });
      render(updated);
      footer.textContent = 'Vielen Dank für Ihre Rückmeldung.';
    } catch (error) {
      button.disabled = false;
      button.textContent = label;
      footer.innerHTML = `<span style="color:#b91c1c">${esc(error.message)}</span>`;
    }
  };

  body.querySelector('#confirm')?.addEventListener('click', (event) => run(event.currentTarget, 'confirm'));
  body.querySelector('#decline-toggle')?.addEventListener('click', () => {
    body.querySelector('#decline-area')?.classList.toggle('hidden');
    body.querySelector('#decline-text')?.focus();
  });
  body.querySelector('#decline-send')?.addEventListener('click', (event) => {
    run(event.currentTarget, 'decline', { message: body.querySelector('#decline-text')?.value || '' });
  });
  body.querySelector('#change')?.addEventListener('click', (event) => {
    if (appointment.confirmed_at) {
      body.querySelector('#change').outerHTML = `
        <div id="decline-area">
          <textarea id="decline-text" maxlength="500" placeholder="Optional: Grund oder Wunschtermin"></textarea>
          <div class="actions"><button class="btn-primary" id="decline-send">Rückmeldung senden</button></div>
        </div>`;
      body.querySelector('#decline-send').addEventListener('click', (ev) => {
        run(ev.currentTarget, 'decline', { message: body.querySelector('#decline-text')?.value || '' });
      });
    } else {
      run(event.currentTarget, 'confirm');
    }
  });
}

async function load() {
  try {
    const data = await request(`/api/public/appointments/${token}`);
    render(data);
  } catch (error) {
    headline.textContent = 'Termin nicht gefunden';
    body.innerHTML = `<div class="state error"><strong>Dieser Link funktioniert nicht</strong>
      ${esc(error.message)}<br />Bitte wenden Sie sich direkt an uns.</div>`;
    footer.textContent = 'Tipp: Prüfen Sie, ob der Link vollständig kopiert wurde.';
  }
}

load();
