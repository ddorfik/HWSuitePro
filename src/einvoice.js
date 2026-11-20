/**
 * E-Rechnung ohne externe Abhängigkeiten.
 *
 * - XRechnung 3.0 als UBL-2.1-XML
 * - ZUGFeRD 2.x (EN 16931, Comfort) als CII-XML
 * - ZUGFeRD-PDF: Rechnungs-PDF mit eingebettetem CII-XML (PDF/A-3-ähnlich)
 *
 * Die erzeugten Dateien sind bewusst konservativ aufgebaut. Eine formale
 * Validierung (KoSIT-/ZUGFeRD-Prüftool) ersetzt das nicht.
 */

const UBL_NS = 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';
const CAC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2';
const CBC = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2';
const RSM = 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100';
const RAM = 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100';
const UDT = 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100';

const UNIT_CODES = {
  stk: 'C62', stück: 'C62', stueck: 'C62', c62: 'C62',
  std: 'HUR', h: 'HUR', stunde: 'HUR', stunden: 'HUR',
  tag: 'DAY', tage: 'DAY', monat: 'MON', monate: 'MON',
  m: 'MTR', meter: 'MTR', lfm: 'MTR',
  'm²': 'MTK', m2: 'MTK', qm: 'MTK', 'm³': 'MTQ', m3: 'MTQ', cbm: 'MTQ',
  kg: 'KGM', g: 'GRM', l: 'LTR', liter: 'LTR', ml: 'MLT',
  pauschale: 'C62', psch: 'C62', paket: 'C62', eimer: 'C62', rolle: 'C62',
};

export function unitCode(unit) {
  const key = String(unit || '').trim().toLowerCase();
  return UNIT_CODES[key] || 'C62';
}

export function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const money = (value) => (Math.round((Number(value) + Number.EPSILON) * 100) / 100).toFixed(2);
const quantity = (value) => {
  const n = Number(value) || 0;
  return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
};
const compactDate = (iso) => String(iso || '').slice(0, 10).replace(/-/g, '');

export function invoiceNumber(invoice) {
  return String(invoice?.number || 'RE-0000');
}

function seller(settings) {
  return {
    name: settings.company_name || 'Handwerksbetrieb',
    street: settings.company_street || '',
    zip: settings.company_zip || '',
    city: settings.company_city || '',
    country: 'DE',
    vatId: settings.vat_id || '',
    taxNumber: settings.tax_number || '',
    register: [settings.register_court, settings.register_number].filter(Boolean).join(' '),
    phone: settings.einvoice_seller_phone || settings.company_phone || '',
    email: settings.einvoice_seller_email || settings.company_email || '',
    contact: settings.einvoice_seller_contact || settings.company_owner || settings.company_name || '',
    iban: String(settings.iban || '').replace(/\s+/g, ''),
    bic: String(settings.bic || '').replace(/\s+/g, ''),
    bank: settings.bank_name || '',
    creditorId: settings.sepa_creditor_id || '',
  };
}

function buyer(customer) {
  const name = customer.type === 'Firma' && customer.company
    ? customer.company
    : [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company || 'Kunde';
  return {
    name,
    street: customer.street || '',
    zip: customer.zip || '',
    city: customer.city || '',
    country: 'DE',
    vatId: customer.vat_id || '',
    email: customer.email || '',
    leitwegId: customer.leitweg_id || '',
  };
}

function taxMode(settings, invoice) {
  // Kleinunternehmer § 19 UStG: steuerbefreite Rechnung (Kategorie E).
  if (settings.small_business === '1') {
    return { code: 'E', rate: 0, exempt: true, reason: 'Steuerbefreit nach § 19 UStG' };
  }
  const rate = Number(invoice.tax_rate);
  return { code: 'S', rate, exempt: false, reason: '' };
}

function lineItems(data) {
  return (data.items || []).map((item, index) => {
    const net = Math.round((Number(item.quantity) * Number(item.unit_price) + Number.EPSILON) * 100) / 100;
    return {
      index: index + 1,
      description: item.description || 'Leistung',
      quantity: Number(item.quantity) || 0,
      unit: item.unit || 'Stk',
      unitCode: unitCode(item.unit),
      unitPrice: Number(item.unit_price) || 0,
      net,
    };
  });
}

/* ------------------------------------------------------------------ XRechnung (UBL) */

export function buildXRechnung(data, settings) {
  const { invoice, customer } = data;
  const supplier = seller(settings);
  const customerParty = buyer(customer);
  const tax = taxMode(settings, invoice);
  const lines = lineItems(data);
  const net = Number(invoice.subtotal) || lines.reduce((sum, line) => sum + line.net, 0);
  const taxAmount = tax.exempt ? 0 : Number(invoice.tax_total) || 0;
  const gross = Number(invoice.total) || net + taxAmount;
  const buyerReference = invoice.buyer_reference || customerParty.leitwegId || invoice.number;
  const paymentMeans = settings.einvoice_payment_means || '58';

  const party = (tag, partyData, withContact) => `
  <cac:${tag}>
    <cac:Party>
      <cac:PartyName><cbc:Name>${xmlEscape(partyData.name)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${xmlEscape(partyData.street)}</cbc:StreetName>
        <cbc:CityName>${xmlEscape(partyData.city)}</cbc:CityName>
        <cbc:PostalZone>${xmlEscape(partyData.zip)}</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>${xmlEscape(partyData.country)}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      ${partyData.vatId ? `<cac:PartyTaxScheme>
        <cbc:CompanyID>${xmlEscape(partyData.vatId)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>` : ''}
      ${withContact ? `<cac:Contact>
        <cbc:Name>${xmlEscape(supplier.contact)}</cbc:Name>
        <cbc:Telephone>${xmlEscape(supplier.phone)}</cbc:Telephone>
        <cbc:ElectronicMail>${xmlEscape(supplier.email)}</cbc:ElectronicMail>
      </cac:Contact>` : ''}
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${xmlEscape(partyData.name)}</cbc:RegistrationName>
        ${partyData === supplier && supplier.register ? `<cbc:CompanyID>${xmlEscape(supplier.register)}</cbc:CompanyID>` : ''}
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:${tag}>`;

  const invoiceLines = lines.map((line) => `
  <cac:InvoiceLine>
    <cbc:ID>${line.index}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${line.unitCode}">${quantity(line.quantity)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="EUR">${money(line.net)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${xmlEscape(line.description)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${tax.code}</cbc:ID>
        <cbc:Percent>${money(tax.rate)}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="EUR">${money(line.unitPrice)}</cbc:PriceAmount>
      <cbc:BaseQuantity unitCode="${line.unitCode}">1</cbc:BaseQuantity>
    </cac:Price>
  </cac:InvoiceLine>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="${UBL_NS}" xmlns:cac="${CAC}" xmlns:cbc="${CBC}">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xoev-de:kosit:standard:xrechnung_3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${xmlEscape(invoice.number)}</cbc:ID>
  <cbc:IssueDate>${String(invoice.date).slice(0, 10)}</cbc:IssueDate>
  <cbc:DueDate>${String(invoice.due_date).slice(0, 10)}</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:Note>${xmlEscape(invoice.notes || settings.einvoice_note || '')}</cbc:Note>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>${xmlEscape(buyerReference)}</cbc:BuyerReference>
  ${invoice.order_id ? `<cac:OrderReference><cbc:ID>${xmlEscape(data.order?.number || '')}</cbc:ID></cac:OrderReference>` : ''}
  ${party('AccountingSupplierParty', supplier, true)}
  ${party('AccountingCustomerParty', customerParty, false)}
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>${xmlEscape(paymentMeans)}</cbc:PaymentMeansCode>
    <cbc:PaymentID>${xmlEscape(invoice.number)}</cbc:PaymentID>
    ${supplier.iban ? `<cac:PayeeFinancialAccount>
      <cbc:ID>${xmlEscape(supplier.iban)}</cbc:ID>
      ${supplier.bic ? `<cac:FinancialInstitutionBranch><cbc:ID>${xmlEscape(supplier.bic)}</cbc:ID></cac:FinancialInstitutionBranch>` : ''}
    </cac:PayeeFinancialAccount>` : ''}
  </cac:PaymentMeans>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">${money(taxAmount)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="EUR">${money(net)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="EUR">${money(taxAmount)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${tax.code}</cbc:ID>
        <cbc:Percent>${money(tax.rate)}</cbc:Percent>
        ${tax.exempt ? `<cbc:TaxExemptionReason>${xmlEscape(tax.reason)}</cbc:TaxExemptionReason>` : ''}
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">${money(net)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">${money(net)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">${money(gross)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">${money(gross)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  ${invoiceLines}
</Invoice>
`;
}

/* ------------------------------------------------------------------ ZUGFeRD (CII) */

export function buildZugferdXml(data, settings) {
  const { invoice, customer } = data;
  const supplier = seller(settings);
  const customerParty = buyer(customer);
  const tax = taxMode(settings, invoice);
  const lines = lineItems(data);
  const net = Number(invoice.subtotal) || lines.reduce((sum, line) => sum + line.net, 0);
  const taxAmount = tax.exempt ? 0 : Number(invoice.tax_total) || 0;
  const gross = Number(invoice.total) || net + taxAmount;
  const buyerReference = invoice.buyer_reference || customerParty.leitwegId || invoice.number;

  const tradeParty = (tag, partyData, withContact) => `
    <ram:${tag}>
      <ram:ID>${xmlEscape(partyData.name)}</ram:ID>
      <ram:Name>${xmlEscape(partyData.name)}</ram:Name>
      <ram:PostalTradeAddress>
        <ram:PostcodeCode>${xmlEscape(partyData.zip)}</ram:PostcodeCode>
        <ram:LineOne>${xmlEscape(partyData.street)}</ram:LineOne>
        <ram:CityName>${xmlEscape(partyData.city)}</ram:CityName>
        <ram:CountryID>${xmlEscape(partyData.country)}</ram:CountryID>
      </ram:PostalTradeAddress>
      ${withContact ? `<ram:DefinedTradeContact>
        <ram:PersonName>${xmlEscape(supplier.contact)}</ram:PersonName>
        <ram:TelephoneUniversalCommunication><ram:CompleteNumber>${xmlEscape(supplier.phone)}</ram:CompleteNumber></ram:TelephoneUniversalCommunication>
        <ram:EmailURIUniversalCommunication><ram:URIID>${xmlEscape(supplier.email)}</ram:URIID></ram:EmailURIUniversalCommunication>
      </ram:DefinedTradeContact>` : ''}
      ${partyData.vatId ? `<ram:SpecifiedTaxRegistration>
        <ram:ID schemeID="VA">${xmlEscape(partyData.vatId)}</ram:ID>
      </ram:SpecifiedTaxRegistration>` : ''}
    </ram:${tag}>`;

  const lineXml = lines.map((line) => `
      <ram:IncludedSupplyChainTradeLineItem>
        <ram:AssociatedDocumentLineDocument><ram:LineID>${line.index}</ram:LineID></ram:AssociatedDocumentLineDocument>
        <ram:SpecifiedTradeProduct>
          <ram:Name>${xmlEscape(line.description)}</ram:Name>
        </ram:SpecifiedTradeProduct>
        <ram:SpecifiedLineTradeAgreement>
          <ram:NetPriceProductTradePrice>
            <ram:ChargeAmount>${money(line.unitPrice)}</ram:ChargeAmount>
            <ram:BasisQuantity unitCode="${line.unitCode}">1</ram:BasisQuantity>
          </ram:NetPriceProductTradePrice>
        </ram:SpecifiedLineTradeAgreement>
        <ram:SpecifiedLineTradeDelivery>
          <ram:BilledQuantity unitCode="${line.unitCode}">${quantity(line.quantity)}</ram:BilledQuantity>
        </ram:SpecifiedLineTradeDelivery>
        <ram:SpecifiedLineTradeSettlement>
          <ram:ApplicableTradeTax>
            <ram:TypeCode>VAT</ram:TypeCode>
            <ram:CategoryCode>${tax.code}</ram:CategoryCode>
            <ram:RateApplicablePercent>${money(tax.rate)}</ram:RateApplicablePercent>
          </ram:ApplicableTradeTax>
          <ram:SpecifiedTradeSettlementLineMonetarySummation>
            <ram:LineTotalAmount>${money(line.net)}</ram:LineTotalAmount>
          </ram:SpecifiedTradeSettlementLineMonetarySummation>
        </ram:SpecifiedLineTradeSettlement>
      </ram:IncludedSupplyChainTradeLineItem>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="${RSM}" xmlns:ram="${RAM}" xmlns:udt="${UDT}">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>urn:cen.eu:en16931:2017</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${xmlEscape(invoice.number)}</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">${compactDate(invoice.date)}</udt:DateTimeString></ram:IssueDateTime>
    <ram:IncludedNote><ram:Content>${xmlEscape(invoice.notes || settings.einvoice_note || '')}</ram:Content></ram:IncludedNote>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    ${lineXml}
    <ram:ApplicableHeaderTradeAgreement>
      <ram:BuyerReference>${xmlEscape(buyerReference)}</ram:BuyerReference>
      ${tradeParty('SellerTradeParty', supplier, true)}
      ${tradeParty('BuyerTradeParty', customerParty, false)}
      ${invoice.order_id ? `<ram:BuyerOrderReferencedDocument><ram:IssuerAssignedID>${xmlEscape(data.order?.number || '')}</ram:IssuerAssignedID></ram:BuyerOrderReferencedDocument>` : ''}
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery/>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:TypeCode>${xmlEscape(settings.einvoice_payment_means || '58')}</ram:TypeCode>
        <ram:Information>${xmlEscape(invoice.number)}</ram:Information>
        ${supplier.iban ? `<ram:PayeePartyCreditorFinancialAccount>
          <ram:IBANID>${xmlEscape(supplier.iban)}</ram:IBANID>
          ${supplier.bic ? `<ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${xmlEscape(supplier.bic)}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>` : ''}
        </ram:PayeePartyCreditorFinancialAccount>` : ''}
      </ram:SpecifiedTradeSettlementPaymentMeans>
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>${money(taxAmount)}</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>
        ${tax.exempt ? `<ram:ExemptionReason>${xmlEscape(tax.reason)}</ram:ExemptionReason>` : ''}
        <ram:BasisAmount>${money(net)}</ram:BasisAmount>
        <ram:CategoryCode>${tax.code}</ram:CategoryCode>
        <ram:RateApplicablePercent>${money(tax.rate)}</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>
      <ram:SpecifiedTradePaymentTerms>
        <ram:DueDateDateTime><udt:DateTimeString format="102">${compactDate(invoice.due_date)}</udt:DateTimeString></ram:DueDateDateTime>
      </ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${money(net)}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${money(net)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">${money(taxAmount)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${money(gross)}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${money(gross)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;
}

export function einvoiceXml(data, settings, format = 'xrechnung') {
  return format === 'zugferd'
    ? buildZugferdXml(data, settings)
    : buildXRechnung(data, settings);
}

export function xmlFilename(invoice, format = 'xrechnung') {
  const safe = String(invoice.number || 'Rechnung').replace(/[^A-Za-z0-9._-]+/g, '-');
  return `${safe}-${format === 'zugferd' ? 'zugferd' : 'xrechnung'}.xml`;
}
