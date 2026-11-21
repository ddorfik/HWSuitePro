/* Kundenportal – tokenisierter Lesezugriff, ohne Anmeldung */
const token = location.pathname.split('/').filter(Boolean).pop();
const body = document.getElementById('body');
const headline = document.getElementById('headline');
const subtitle = document.getElementById('subtitle');
const kicker = document.getElementById('kicker');
const footer = document.getElementById('footer');
const brandName = document.getElementById('brand-name');

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

const moneyFmt = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const money = (value) => moneyFmt.format(Number(value) || 0);
const fmtDate = (value) => value ? new Date(value).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '–';
const fmtDateTime = (value) => value ? new Date(value).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–';

const ORDER_STATUS = {
  neu: 'Neu', geplant: 'Geplant', in_arbeit: 'In Arbeit', erledigt: 'Erledigt',
  abgerechnet: 'Abgerechnet', storniert: 'Storniert',
};
const INVOICE_STATUS = {
  offen: 'Offen', teilweise: 'Teilweise bezahlt', bezahlt: 'Bezahlt', gemahnt: 'Zahlungserinnerung',
};

async function request(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Unbekannter Fehler');
  return data;
}

function appointmentRows(appointments) {
  if (!appointments.length) return '<div class="row"><div class="main small">Keine anstehenden Termine.</div></div>';
  return appointments.map((appointment) => `
    <div class="row">
      <div class="main">
        <b>${esc(appointment.title)}</b>
        <small>${esc(fmtDateTime(appointment.start_at))} Uhr${appointment.location ? ` · ${esc(appointment.location)}` : ''}</small>
      </div>
      ${appointment.confirmed_at
        ? '<span class="badge ok">bestätigt</span>'
        : appointment.declined_at
          ? '<span class="badge danger">abgelehnt</span>'
          : '<span class="badge warn">offen</span>'}
    </div>`).join('');
}

function orderRows(orders) {
  if (!orders.length) return '<div class="row"><div class="main small">Noch keine Aufträge.</div></div>';
  return orders.map((order) => `
    <div class="row">
      <div class="main"><b>${esc(order.number)} · ${esc(order.title)}</b>
        <small>${order.scheduled_date ? `Termin: ${esc(fmtDate(order.scheduled_date))}` : `angelegt am ${esc(fmtDate(order.created_at))}`}</small></div>
      <span class="badge ${order.status === 'erledigt' || order.status === 'abgerechnet' ? 'ok' : ''}">${esc(ORDER_STATUS[order.status] || order.status)}</span>
    </div>`).join('');
}

function invoiceRows(invoices) {
  if (!invoices.length) return '<div class="row"><div class="main small">Keine Rechnungen.</div></div>';
  return invoices.map((invoice) => `
    <div class="row">
      <div class="main"><b>${esc(invoice.number)}</b>
        <small>${esc(fmtDate(invoice.date))} · fällig ${esc(fmtDate(invoice.due_date))} · ${esc(INVOICE_STATUS[invoice.status] || invoice.status)}</small>
        <div style="margin-top:6px"><a class="link" href="/api/public/portal/${encodeURIComponent(token)}/invoices/${invoice.id}/pdf" target="_blank" rel="noopener">Rechnung als PDF öffnen</a></div>
      </div>
      <div class="amount">${money(invoice.total)}<br /><small style="font-weight:500;color:#64748b">offen ${money(invoice.open_amount)}</small></div>
    </div>`).join('');
}

function documentRows(documents) {
  if (!documents.length) return '<div class="row"><div class="main small">Keine Dokumente freigegeben.</div></div>';
  return documents.map((doc) => `
    <div class="row">
      <div class="main"><b>${esc(doc.title)}</b><small>${esc(fmtDate(doc.created_at))}</small></div>
      <a class="btn" href="/api/public/portal/${encodeURIComponent(token)}/documents/${doc.id}/file" target="_blank" rel="noopener">Öffnen</a>
    </div>`).join('');
}

function render(data) {
  const customer = data.customer || {};
  if (customer.name) {
    headline.textContent = customer.name;
    brandName.textContent = customer.name;
    document.title = `Kundenportal · ${customer.name}`;
  }
  kicker.textContent = 'Ihre Übersicht';
  subtitle.textContent = [customer.number, customer.address].filter(Boolean).join(' · ');
  footer.textContent = 'Dieser Link ist persönlich. Bitte geben Sie ihn nicht weiter.';

  body.innerHTML = `
    <section><h2>Anstehende Termine</h2>${appointmentRows(data.appointments || [])}</section>
    <section><h2>Ihre Aufträge</h2>${orderRows(data.orders || [])}</section>
    <section><h2>Rechnungen</h2>${invoiceRows(data.invoices || [])}
      ${data.can_pay_online ? '' : '<div class="row"><div class="main small">Die Zahlung erfolgt bequem per Banküberweisung auf das auf der Rechnung genannte Konto.</div></div>'}
    </section>
    <section><h2>Dokumente</h2>${documentRows(data.documents || [])}</section>
    <section><h2>Nachricht an uns</h2>
      <form id="portal-message" style="padding:13px;display:grid;gap:10px">
        <textarea name="body" maxlength="4000" placeholder="Schreiben Sie uns – z. B. einen Wunschtermin oder eine Frage zu Ihrer Rechnung."></textarea>
        <button class="btn btn-primary" type="submit">Nachricht senden</button>
      </form>
    </section>`;

  const form = document.getElementById('portal-message');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button');
    const text = form.elements.body.value.trim();
    if (!text) return;
    button.disabled = true;
    button.textContent = 'Wird gesendet …';
    try {
      await request(`/api/public/portal/${encodeURIComponent(token)}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      });
      form.outerHTML = '<div class="state ok" style="margin:13px"><strong>Nachricht gesendet</strong>Vielen Dank – wir melden uns bei Ihnen.</div>';
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Nachricht senden';
      const box = document.createElement('div');
      box.className = 'state error';
      box.innerHTML = `<strong>Das hat nicht geklappt</strong>${esc(error.message)}`;
      form.before(box);
    }
  });
}

async function load() {
  if (!token) {
    headline.textContent = 'Portal nicht gefunden';
    body.innerHTML = '<div class="state error"><strong>Dieser Link ist ungültig</strong>Bitte wenden Sie sich direkt an uns.</div>';
    return;
  }
  try {
    render(await request(`/api/public/portal/${encodeURIComponent(token)}`));
  } catch (error) {
    headline.textContent = 'Portal nicht verfügbar';
    subtitle.textContent = '';
    body.innerHTML = `<div class="state error"><strong>Dieser Link funktioniert nicht</strong>${esc(error.message)}<br />Bitte wenden Sie sich direkt an uns.</div>`;
    footer.textContent = 'Tipp: Prüfen Sie, ob der Link vollständig kopiert wurde.';
  }
}

load();
