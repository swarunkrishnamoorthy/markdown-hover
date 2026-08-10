# Derived glossary sample

A document with no embedded glossary comment. Terms come from the two fallback
sources instead: inline `<abbr>` tags and the table under the Glossary heading.

## Notes

The <abbr title="Adaptive Concurrency Control. Caps in-flight requests per instance and sheds load when latency rises.">ACC</abbr> library is the usual suspect. When a build is promoted to every cell at once, ACC headroom collapses.

Separately, <abbr title="A one-off certificate expiry that took down the ingest path for 40 minutes.">the cert incident</abbr> is not in the table, so it can only come from the abbr tag.

Traffic in ash1 is negligible, so percentile alerts there mean little. Escalate to
PGW only after checking the tier of the DAG.

## Glossary

| Term | Definition |
|---|---|
| **ACC** | Adaptive Concurrency Control. A client-side library that caps in-flight requests and sheds load. Rejections surface as HTTP 503. |
| **ACP** (API Control Plane) | Where service-to-service API keys live. Not ACC, despite the names. |
| **ash1 / ash2 / ash3 / ash4** | Ashburn datacenters, region `us-east-1`. Near-zero traffic, so percentile alerts are statistically meaningless. |
| **DAG** | Directed Acyclic Graph — a scheduled dependency graph of tasks. |
| **Elasticsearch (ES)** | The datastore behind transaction records. Indices go back to 2018. |
| **go/911, go/912** | Internal shortlinks for the incident and escalation runbooks. |
| **PGW / Public Gateway** | The edge proxy terminating external traffic. |
| **tier** (DAG) | The priority class of a pipeline, which decides its paging policy. |
