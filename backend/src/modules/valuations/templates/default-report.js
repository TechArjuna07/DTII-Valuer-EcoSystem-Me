/**
 * Built-in valuation report template (Handlebars). Firms copy it to create bank / NBFC-specific formats in the
 * Report Template Master. Available data: see buildReportContext() in report-context.js.
 */
export const DEFAULT_TEMPLATE = `<!doctype html>
<html><head><meta charset="utf-8"><title>{{case.caseNumber}}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #0b1324; font-size: 10.5px; margin: 0; }
  h1 { font-size: 17px; margin: 0; }
  h2 { font-size: 12px; margin: 16px 0 6px; padding: 5px 8px; background: #0a1633; color: #fff; border-radius: 4px; }
  table { width: 100%; border-collapse: collapse; }
  td, th { border: 1px solid #d7dde8; padding: 4px 6px; vertical-align: top; text-align: left; }
  th { background: #eef1f7; font-weight: 600; }
  .k { width: 32%; color: #5b667a; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .header { display: flex; justify-content: space-between; border-bottom: 3px solid #005df8; padding-bottom: 8px; }
  .muted { color: #5b667a; }
  .values td { font-size: 12px; }
  .values .main td { font-size: 14px; font-weight: 700; background: #e8f0ff; }
  .stamp { margin-top: 6px; display: inline-block; padding: 2px 8px; border: 1px solid #b54708; color: #b54708; border-radius: 4px; font-weight: 700; letter-spacing: .08em; }
  .verify { display: flex; gap: 10px; align-items: center; margin-top: 14px; border: 1px dashed #d7dde8; padding: 8px; border-radius: 6px; }
  .sign { margin-top: 22px; display: flex; justify-content: space-between; }
  .sign div { width: 45%; }
  .line { border-top: 1px solid #0b1324; margin-top: 36px; padding-top: 4px; }
</style></head>
<body>
  <div class="header">
    <div>
      <h1>{{firm.name}}</h1>
      <div class="muted">{{firm.address}}</div>
      <div class="muted">{{#if firm.registrationNo}}Reg. no. {{firm.registrationNo}} · {{/if}}{{#if firm.gstin}}GSTIN {{firm.gstin}} · {{/if}}{{firm.email}} {{firm.phone}}</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:13px;font-weight:700">{{report.title}}</div>
      <div>Case ID <b>{{case.caseNumber}}</b></div>
      <div>Report v{{report.version}} · {{report.issueDate}}</div>
      {{#if report.isPreliminary}}<div class="stamp">PRELIMINARY – NOT FOR SUBMISSION</div>{{/if}}
    </div>
  </div>

  <h2>1. Engagement</h2>
  <table>
    <tr><td class="k">Lender</td><td>{{bank.name}}{{#if bank.branch}}, {{bank.branch}}{{/if}}</td></tr>
    <tr><td class="k">Loan applicant / owner</td><td>{{client.name}} ({{client.type}})</td></tr>
    <tr><td class="k">Loan reference / type</td><td>{{default case.loanReference "—"}} / {{default case.loanType "—"}}</td></tr>
    <tr><td class="k">Purpose of valuation</td><td>Assessment of fair market value for lending (security) purposes</td></tr>
    <tr><td class="k">Valuation category</td><td>{{category.name}}</td></tr>
    <tr><td class="k">Financial year / date of receipt</td><td>{{case.financialYear}} / {{case.receivedOn}}</td></tr>
  </table>

  <h2>2. Property / asset particulars</h2>
  <table>
    {{#each property.fields}}<tr><td class="k">{{label}}</td><td>{{value}}</td></tr>{{/each}}
  </table>

  {{#if inspection}}
  <h2>3. Site inspection</h2>
  <table>
    <tr><td class="k">Inspected by / on</td><td>{{inspection.officer}} · {{inspection.date}}</td></tr>
    <tr><td class="k">Address as inspected</td><td>{{inspection.address}}</td></tr>
    <tr><td class="k">GPS coordinates</td><td>{{inspection.gps}}</td></tr>
    <tr><td class="k">Land / building area</td><td>{{inspection.landArea}} · {{inspection.buildingArea}}</td></tr>
    <tr><td class="k">Condition / construction</td><td>{{inspection.condition}} · {{inspection.construction}}</td></tr>
    <tr><td class="k">Boundaries</td><td>{{inspection.boundaries}}</td></tr>
    <tr><td class="k">Landmarks</td><td>{{inspection.landmarks}}</td></tr>
    <tr><td class="k">Photographs</td><td>{{inspection.photoCount}} photographs on record (case repository 03_Property_Photographs)</td></tr>
  </table>
  {{/if}}

  <h2>4. Valuation computation</h2>
  <table>
    <tr><th>Section</th><th>Particulars</th><th class="num">Quantity</th><th class="num">Rate (₹)</th><th class="num">Amount (₹)</th></tr>
    {{#each valuation.lines}}
    <tr><td>{{section}}</td><td>{{label}}{{#if note}}<div class="muted">{{note}}</div>{{/if}}</td><td class="num">{{#if quantity}}{{num quantity}} {{unit}}{{/if}}</td><td class="num">{{#if rate}}{{inr rate}}{{/if}}</td><td class="num">{{inr amount}}</td></tr>
    {{/each}}
  </table>

  <h2>5. Valuation summary</h2>
  <table class="values">
    <tr class="main"><td class="k">Fair market value</td><td class="num">₹ {{inr valuation.marketValue}}</td></tr>
    <tr><td class="k">In words</td><td>{{valuation.marketValueWords}}</td></tr>
    <tr><td class="k">Realisable value</td><td class="num">₹ {{inr valuation.realisableValue}}</td></tr>
    <tr><td class="k">Distress / forced sale value</td><td class="num">₹ {{inr valuation.distressValue}}</td></tr>
    {{#if valuation.guidelineValue}}<tr><td class="k">Government guideline value</td><td class="num">₹ {{inr valuation.guidelineValue}}</td></tr>{{/if}}
    {{#if valuation.insurableValue}}<tr><td class="k">Insurable value</td><td class="num">₹ {{inr valuation.insurableValue}}</td></tr>{{/if}}
  </table>
  {{#if valuation.summary}}<p>{{valuation.summary}}</p>{{/if}}
  <p class="muted">Assumptions: {{#each valuation.assumptions}}{{this}}{{#unless @last}}; {{/unless}}{{/each}}.</p>

  <h2>6. Declaration</h2>
  <p>I/We hereby declare that the property was inspected as stated, that the information furnished is true and correct to the best of my/our knowledge, and that I/we have no direct or indirect interest in the property valued.</p>
  <div class="sign">
    <div><div class="line">Prepared by: {{people.preparedBy}}</div></div>
    <div><div class="line">Valuer: {{people.valuer}}{{#if people.valuerRegistration}} · Reg. {{people.valuerRegistration}}{{/if}}</div><div class="muted">This report is valid only with the valuer's verified digital signature.</div></div>
  </div>

  {{#if verification}}
  <div class="verify">
    <img src="{{verification.qr}}" width="74" height="74" alt="">
    <div>Verify this report: <b>{{verification.url}}</b><br>Verification code <b>{{verification.code}}</b> · Case {{case.caseNumber}}</div>
  </div>
  {{/if}}
</body></html>`;
