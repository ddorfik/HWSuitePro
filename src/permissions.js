/**
 * Rollen- und Rechtematrix.
 * Chef hat alle Rechte. Alle anderen Rollen erhalten klar abgegrenzte Rechte.
 */

export const ROLES = {
  chef: {
    label: 'Chef / Inhaber',
    short: 'Chef',
    description: 'Voller Zugriff auf alle Daten, Einstellungen, Benutzer und Finanzen.',
    color: '#b45309',
  },
  vorgesetzt: {
    label: 'Vorgesetzte/r',
    short: 'Vorgesetzt',
    description: 'Führt Aufträge, Team, Planung und Rechnungen; gibt Berichte frei.',
    color: '#0f766e',
  },
  buero: {
    label: 'Büro',
    short: 'Büro',
    description: 'Kunden, Aufträge, Planung, Rechnungen und Material – ohne Personalfreigaben.',
    color: '#2563eb',
  },
  monteur: {
    label: 'Monteur / Techniker',
    short: 'Monteur',
    description: 'Sieht eigene Aufträge, stempelt Zeiten, erstellt Berichte und Fotos.',
    color: '#7c3aed',
  },
  hr: {
    label: 'Personal / HR',
    short: 'HR',
    description: 'Verwaltet Mitarbeiter, Zeiten und Personaldaten – ohne Finanzen.',
    color: '#be123c',
  },
};

const ROLE_PERMISSIONS = {
  vorgesetzt: [
    'dashboard.view',
    'orders.view.all', 'orders.manage', 'orders.progress',
    'customers.view', 'customers.manage',
    'invoices.view', 'invoices.manage',
    'planning.view', 'planning.manage',
    'warehouse.view', 'warehouse.manage',
    'contracts.view', 'contracts.manage',
    'reports.view.all', 'reports.manage', 'reports.approve', 'reports.own',
    'photos.manage', 'photos.own',
    'time.view.all', 'time.manage', 'time.own',
    'employees.view', 'employees.manage', 'employees.rates',
    'automation.run', 'exports.run',
    'documents.view', 'documents.manage',
    'finance.view', 'finance.manage',
    'calculation.manage', 'resources.manage', 'assistant.use', 'hr.manage',
  ],
  buero: [
    'dashboard.view',
    'orders.view.all', 'orders.manage', 'orders.progress',
    'customers.view', 'customers.manage',
    'invoices.view', 'invoices.manage',
    'planning.view', 'planning.manage',
    'warehouse.view', 'warehouse.manage',
    'contracts.view', 'contracts.manage',
    'reports.view.all', 'reports.manage',
    'photos.manage',
    'time.view.all', 'time.manage', 'time.own',
    'employees.view',
    'automation.run', 'exports.run',
    'documents.view', 'documents.manage',
    'finance.view', 'finance.manage',
    'calculation.manage', 'resources.manage', 'assistant.use',
  ],
  monteur: [
    'dashboard.view',
    'orders.view.own', 'orders.progress',
    'customers.view',
    'planning.view',
    'warehouse.view',
    'reports.own',
    'photos.own',
    'time.own',
    'employees.view',
  ],
  hr: [
    'dashboard.view',
    'employees.view', 'employees.manage', 'employees.rates',
    'time.view.all', 'time.manage', 'time.own',
    'reports.view.all',
    'hr.manage', 'assistant.use',
  ],
};

export function permissionsFor(role) {
  if (role === 'chef') return ['*'];
  return ROLE_PERMISSIONS[role] ?? [];
}

export function can(user, permission) {
  if (!user) return false;
  if (user.role === 'chef') return true;
  if (!permission) return true;
  const permissions = user.permissions ?? permissionsFor(user.role);
  if (permissions.includes('*')) return true;
  return permissions.includes(permission);
}

export function canAny(user, permissions = []) {
  return permissions.some((permission) => can(user, permission));
}

export function roleLabel(role) {
  return ROLES[role]?.label ?? role;
}

export const PERMISSION_LABELS = {
  'dashboard.view': 'Übersicht',
  'orders.view.all': 'Alle Aufträge sehen',
  'orders.view.own': 'Eigene Aufträge sehen',
  'orders.manage': 'Aufträge bearbeiten',
  'orders.progress': 'Auftragsstatus ändern',
  'customers.view': 'Kunden sehen',
  'customers.manage': 'Kunden bearbeiten',
  'invoices.view': 'Rechnungen sehen',
  'invoices.manage': 'Rechnungen erstellen',
  'planning.view': 'Planung sehen',
  'planning.manage': 'Planung bearbeiten',
  'warehouse.view': 'Lager sehen',
  'warehouse.manage': 'Lager bearbeiten',
  'contracts.view': 'Verträge sehen',
  'contracts.manage': 'Verträge bearbeiten',
  'reports.view.all': 'Alle Berichte sehen',
  'reports.own': 'Eigene Berichte',
  'reports.manage': 'Berichte bearbeiten',
  'reports.approve': 'Berichte freigeben',
  'photos.own': 'Eigene Fotos',
  'photos.manage': 'Alle Fotos',
  'time.own': 'Eigene Zeiten',
  'time.view.all': 'Alle Zeiten sehen',
  'time.manage': 'Zeiten bearbeiten',
  'employees.view': 'Team sehen',
  'employees.manage': 'Team verwalten',
  'employees.rates': 'Stundensätze sehen',
  'users.manage': 'Benutzer verwalten',
  'settings.manage': 'Einstellungen',
  'automation.run': 'Automatik',
  'exports.run': 'Exporte',
  'documents.view': 'Dokumente sehen',
  'documents.manage': 'Dokumente archivieren',
  'finance.view': 'Finanzen sehen',
  'finance.manage': 'Bank & SEPA',
  'hr.manage': 'Urlaub & Arbeitszeit',
  'calculation.manage': 'Kalkulation',
  'resources.manage': 'Ressourcen planen',
  'assistant.use': 'Textassistent',
};
