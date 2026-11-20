/**
 * The 10 folders of every case repository (in display order). The folder is document METADATA — storage keys
 * never contain folder or client names (see services/storage). The human-readable tree
 *   Firm / Client / FY / <CASE ID>_<BANK> / 01_Source_Files …
 * is rendered from the database.
 */
const FOLDERS = Object.freeze([
  { code: 'SOURCE_FILES', label: '01_Source_Files', title: 'Source files' },
  { code: 'INSPECTION_DOCUMENTS', label: '02_Inspection_Documents', title: 'Inspection documents' },
  { code: 'PROPERTY_PHOTOGRAPHS', label: '03_Property_Photographs', title: 'Property photographs' },
  { code: 'PRELIMINARY_VALUATION', label: '04_Preliminary_Valuation', title: 'Preliminary valuation' },
  { code: 'SENIOR_REVIEW', label: '05_Senior_Review', title: 'Senior review' },
  { code: 'FINAL_VALUATION_REPORT', label: '06_Final_Valuation_Report', title: 'Final valuation report' },
  { code: 'CLIENT_SIGNED_FILES', label: '07_Client_Signed_Files', title: 'Signed files' },
  { code: 'BANK_SUBMISSION', label: '08_Bank_Submission', title: 'Bank submission' },
  { code: 'SANCTION_DOCUMENTS', label: '09_Sanction_Documents', title: 'Sanction documents' },
  { code: 'DISBURSEMENT_DOCUMENTS', label: '10_Disbursement_Documents', title: 'Disbursement documents' },
]);

const FOLDER_CODES = FOLDERS.map((f) => f.code);

export { FOLDERS, FOLDER_CODES };
