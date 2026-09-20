# Security and data handling

Jev Explorer automates a real browser. Use it only for work you are authorized to perform, with appropriately restricted accounts.

Jev classifies observed action effects from the objective and page context. Code requires explicit commit permission for actions classified as business mutations; conflicting or unknown effects are not authorized. Grounded input adapters perform the requested field operations. These checks depend on model judgments and observable page semantics. They are not a browser sandbox, a universal read-only guarantee, or protection against every malicious interface. A page may perform side effects during typing or through an innocuously named control. Closing the browser does not undo those effects.

Page text, control labels, and source context may be sent to TypeSafe for decisions. Typed binding initially uses data keys, types and descriptions; a candidate value may also be sent for ambiguity confirmation, option selection or widget readback. Full traces and screenshots remain local and can contain private application data. Do not attach raw run directories, browser state, passwords, API keys, or private screenshots to public issues.

The runtime creates private session directories and restricts artifact file permissions where the operating system supports them. Explicit password-field input is redacted from its retained trace. This is not a general-purpose PII anonymizer.

An unknown submission outcome requires explicit supervisor resolution before retry. Model confidence and page content do not authorize additional effects.

## Reporting a vulnerability

Use this repository's **Security → Report a vulnerability** flow for private reports. Include a minimal reproduction using synthetic values. Never include a working credential or another party's data.
