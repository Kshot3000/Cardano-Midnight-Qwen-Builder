// throwaway: spec vector check (reads exact spec payload from fixture)
import { readFileSync } from "node:fs";
import {
  encodeState,
  decodeState,
  stateHash,
  makeOffchainDid,
  parseDid,
  resolveDid,
  projectDocument,
} from "../src/midnight-did.js";

const SPEC_STATE = {
  version: 1,
  alsoKnownAs: ["https://example.org/holders/alice"],
  verificationMethod: [
    {
      id: "#holder-key-1",
      publicKeyJwk: {
        kty: "EC",
        crv: "Jubjub",
        x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        y: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
      },
      relationships: {
        authentication: true,
        assertionMethod: true,
        keyAgreement: false,
        capabilityInvocation: false,
        capabilityDelegation: false,
      },
    },
  ],
  service: [
    {
      id: "#profile",
      type: "LinkedDomains",
      serviceEndpoint: "https://example.org/profile/alice",
    },
  ],
};

const SPEC_PAYLOAD = readFileSync(new URL("./spec-vector.txt", import.meta.url), "utf8").trim();
const SPEC_HASH =
  "3c08b85758d973a6002942c730d077ede51920c184927aaf010562035203fc21";
const SPEC_LONG = "did:midnight:offchain:" + SPEC_HASH + ":" + SPEC_PAYLOAD;

let fails = 0;
function check(name, cond, extra) {
  if (!cond) {
    fails++;
    console.error("FAIL", name, extra ?? "");
  } else {
    console.log("ok  ", name);
  }
}

const enc = encodeState(SPEC_STATE);
check("encode == spec payload", enc === SPEC_PAYLOAD, "\n got " + enc + "\n exp " + SPEC_PAYLOAD);
check("hash == spec hash", stateHash(SPEC_PAYLOAD) === SPEC_HASH, stateHash(SPEC_PAYLOAD));

const long = makeOffchainDid(SPEC_STATE, { long: true });
check("long-form DID == spec", long === SPEC_LONG);
const short = makeOffchainDid(SPEC_STATE, { long: false });
check("short-form DID", short === "did:midnight:offchain:" + SPEC_HASH);

const dec = decodeState(SPEC_PAYLOAD);
check("decoded aka", dec.aka.length === 1 && dec.aka[0] === "https://example.org/holders/alice");
check("decoded vm", dec.vms.length === 1 && dec.vms[0].id === "#holder-key-1" && dec.vms[0].kind === 1 && dec.vms[0].mask === 0x03);
check("decoded svc", dec.svcs.length === 1 && dec.svcs[0].id === "#profile" && dec.svcs[0].type === "LinkedDomains");

const parsed = parseDid(SPEC_LONG);
check("parse long", parsed.kind === "offchain" && parsed.form === "long" && parsed.hash === SPEC_HASH);
check("parse long subject", parsed.subject === SPEC_LONG);

const pshort = parseDid("did:midnight:offchain:" + SPEC_HASH);
check("parse short", pshort.form === "short" && pshort.payload === null);

const doc = projectDocument(SPEC_LONG, dec);
check("doc id", doc.id === SPEC_LONG);
check("doc context", doc["@context"][0] === "https://www.w3.org/ns/did/v1");
check("doc vm", doc.verificationMethod[0].type === "JsonWebKey" && doc.verificationMethod[0].publicKeyJwk.crv === "Jubjub");
check("doc vm abs id", doc.verificationMethod[0].id.endsWith("#holder-key-1"));
check("doc rel", doc.authentication.length === 1 && doc.assertionMethod.length === 1 && doc.keyAgreement.length === 0);
check("doc svc", doc.service[0].serviceEndpoint === "https://example.org/profile/alice" && doc.service[0].type === "LinkedDomains");

const res = resolveDid(SPEC_LONG);
check("resolve doc present", res.document && res.document.id === SPEC_LONG);

const tampered = "did:midnight:offchain:" + SPEC_HASH + ":" + (SPEC_PAYLOAD[40] === "a" ? "b" : "a") + SPEC_PAYLOAD.slice(41);
let threw = false;
try {
  parseDid(tampered);
} catch (e) {
  threw = /hash mismatch/.test(e.message);
}
check("tampered payload rejected", threw);

console.log(fails === 0 ? "ALL SPEC CHECKS PASSED" : fails + " FAILURES");
process.exit(fails === 0 ? 0 : 1);
