import sjcl from "sjcl";
import {
  g,
  L,
  rev,
  mod,
  rand,
  formula2,
  formula,
  parsePoint,
  Hiprove,
  Hbproof0,
  Hbproof1,
  zero,
  point,
} from "./math";
import { hashWithoutSignature } from "./checkBallot";
import canonicalBallot from "./canonicalBallot";
import checkBallot from "./checkBallot";

type tProof = { nChallenge: bigint; nResponse: bigint };
type tSerializedProof = { challenge: string; response: string };
type tCiphertext = { pAlpha: point; pBeta: point };
type tSerializedCiphertext = { alpha: string; beta: string };

type tAnswerWithoutBlank = {
  choices: Array<tSerializedCiphertext>;
  individual_proofs: Array<Array<tSerializedProof>>;
  overall_proof: Array<tSerializedProof>;
};

type tAnswerWithBlank = {
  choices: Array<tSerializedCiphertext>;
  individual_proofs: Array<Array<tSerializedProof>>;
  blank_proof: Array<tSerializedProof>;
  overall_proof: Array<tSerializedProof>;
};

type tAnswer = tAnswerWithoutBlank | tAnswerWithBlank;

function serializeProof(proof: tProof): tSerializedProof {
  return {
    challenge: proof.nChallenge.toString(),
    response: proof.nResponse.toString(),
  };
}

function serializeCiphertext(c: tCiphertext): tSerializedCiphertext {
  return {
    alpha: rev(c.pAlpha.toHex()),
    beta: rev(c.pBeta.toHex()),
  };
}

export default function (
  state: any,
  sPriv: string,
  choices: Array<Array<number>>,
) {
  if (!checkVotingCode(state, sPriv)) {
    return false;
  }

  const { hPublicCredential, nPrivateCredential } = deriveCredential(
    state,
    sPriv,
  );

  let answers: Array<tAnswer> = [];
  for (let i = 0; i < choices.length; i++) {
    const question = state.setup.payload.election.questions[i];
    const f = question.blank
      ? generateAnswerWithBlank
      : generateAnswerWithoutBlank;
    const answer = f(state, question, sPriv, choices[i]);
    answers.push(answer);
  }

  const ballotWithoutSignature = {
    answers,
    credential: hPublicCredential,
    election_hash: state.setup.fingerprint,
    election_uuid: state.setup.payload.election.uuid,
  };

  const hH = hashWithoutSignature({ payload: ballotWithoutSignature });

  const ballot = {
    ...ballotWithoutSignature,
    signature: signature(nPrivateCredential, hH),
  };

  // TODO: Remove
  console.log("Generated ballot");
  console.log(ballot);
  console.log(canonicalBallot(ballot));

  checkBallot(state, { payload: ballot });

  return ballot;
}

export function checkVotingCode(state: any, sPriv: string) {
  if (
    !/[a-zA-Z0-9]{5}-[a-zA-Z0-9]{6}-[a-zA-Z0-9]{5}-[a-zA-Z0-9]{6}/.test(sPriv)
  ) {
    alert("Invalid credential format");
    return false;
  }

  const { hPublicCredential } = deriveCredential(state, sPriv);

  const electionPublicCredentials = state.credentialsWeights.map(
    (c: any) => c.credential,
  );

  if (electionPublicCredentials.includes(hPublicCredential)) {
    return true;
  } else {
    alert("Incorrect voting code");
    return false;
  }
}

function iproof(
  prefix: string,
  pY: point,
  pAlpha: point,
  pBeta: point,
  r: bigint,
  m: number,
  M: Array<number>,
) {
  const w = rand();
  let commitments: Array<point> = [];
  let proofs: Array<tProof> = [];

  for (let i = 0; i < M.length; i++) {
    if (m !== M[i]) {
      const nChallenge = rand();
      const nResponse = rand();
      proofs.push({ nChallenge, nResponse });
      const [pA, pB] = formula2(pY, pAlpha, pBeta, nChallenge, nResponse, M[i]);
      commitments.push(pA, pB);
    } else {
      // m === M[i]
      proofs.push({ nChallenge: BigInt(0), nResponse: BigInt(0) });
      const pA = g.multiply(w);
      const pB = pY.multiply(w);
      commitments.push(pA, pB);
    }
  }

  const nH = Hiprove(prefix, pAlpha, pBeta, ...commitments);

  const nSumChallenge = proofs.reduce((acc, proof) => {
    return mod(acc + proof.nChallenge, L);
  }, BigInt(0));

  for (let i = 0; i < M.length; i++) {
    if (m === M[i]) {
      proofs[i].nChallenge = mod(nH - nSumChallenge, L);
      proofs[i].nResponse = mod(w - r * proofs[i].nChallenge, L);
    }
  }

  return proofs.map(serializeProof);
}

function generateEncryptions(
  state: any,
  pY: point,
  hPublicCredential: string,
  choices: Array<number>,
) {
  let anR: Array<bigint> = [];
  let aCiphertexts: Array<tCiphertext> = [];
  let aIndividualProofs: Array<Array<tSerializedProof>> = [];

  for (let i = 0; i < choices.length; i++) {
    const nR = rand();
    const gPowerM = choices[i] === 0 ? zero : g.multiply(BigInt(choices[i]));
    const pAlpha = g.multiply(nR);
    const pBeta = pY.multiply(nR).add(gPowerM);

    const S = `${state.setup.fingerprint}|${hPublicCredential}`;
    const proof = iproof(S, pY, pAlpha, pBeta, nR, choices[i], [0, 1]);

    aCiphertexts.push({ pAlpha, pBeta });
    aIndividualProofs.push(proof);
    anR.push(nR);
  }

  return { anR, aCiphertexts, aIndividualProofs };
}

function generateAnswerWithoutBlank(
  state: any,
  question: any,
  sPriv: string,
  choices: Array<number>,
): tAnswerWithoutBlank {
  const pY = parsePoint(state.setup.payload.election.public_key);
  const { hPublicCredential } = deriveCredential(state, sPriv);
  const { anR, aCiphertexts, aIndividualProofs } = generateEncryptions(
    state,
    pY,
    hPublicCredential,
    choices,
  );

  const pSumAlpha = aCiphertexts.reduce((acc, c) => acc.add(c.pAlpha), zero);
  const pSumBeta = aCiphertexts.reduce((acc, c) => acc.add(c.pBeta), zero);
  const m = choices.reduce((acc, c) => c + acc, 0);
  const M = Array.from({ length: question.max - question.min + 1 }).map(
    (_, i) => i + question.min,
  );
  const nR = anR.reduce((acc, r) => mod(acc + r, L), BigInt(0));

  let S = `${state.setup.fingerprint}|${hPublicCredential}|`;
  S += aCiphertexts
    .map((c) => `${rev(c.pAlpha.toHex())},${rev(c.pBeta.toHex())}`)
    .join(",");
  const overallProof = iproof(S, pY, pSumAlpha, pSumBeta, nR, m, M);

  return {
    choices: aCiphertexts.map(serializeCiphertext),
    individual_proofs: aIndividualProofs,
    overall_proof: overallProof,
  };
}

function blankProofs(
  state: any,
  hPub: string,
  pY: point,
  choices: Array<tCiphertext>,
  pAlphaS: point,
  pBetaS: point,
  nR0: bigint,
): Array<tProof> {
  const nChallengeP = rand();
  const nResponseP = rand();
  const pAS = formula(g,  nResponseP, pAlphaS, nChallengeP);
  const pBS = formula(pY, nResponseP, pBetaS, nChallengeP);
  const nW = rand();
  const pA0 = g.multiply(nW);
  const pB0 = pY.multiply(nW);

  let S = `${state.setup.fingerprint}|${hPub}|`;
  S += choices.map((c) => `${rev(c.pAlpha.toHex())},${rev(c.pBeta.toHex())}`).join(",");
  const nChallenge0 = Hbproof0(state.setup.fingerprint, pA0, pB0, pAS, pBS);
  const nResponse0 = mod(nW - nChallenge0 * nR0, L);

  return [
    { nChallenge: nChallenge0, nResponse: nResponse0 },
    { nChallenge: nChallengeP, nResponse: nResponseP },
  ];
}

function generateAnswerWithBlank(
  state: any,
  question: any,
  sPriv: string,
  choices: Array<number>,
): tAnswerWithBlank {
  const pY = parsePoint(state.setup.payload.election.public_key);
  const { hPublicCredential } = deriveCredential(state, sPriv);
  const { anR, aCiphertexts, aIndividualProofs } = generateEncryptions(
    state,
    pY,
    hPublicCredential,
    choices,
  );

  const pAlphaS = aCiphertexts.slice(1).reduce((acc, c) => acc.add(c.pAlpha), zero);
  const pBetaS = aCiphertexts.slice(1).reduce((acc, c) => acc.add(c.pBeta), zero);
  const pAlpha0 = aCiphertexts[0].pAlpha;
  const pBeta0 = aCiphertexts[0].pBeta;
  const m = choices.slice(1).reduce((acc, c) => c + acc, 0);
  const M = Array.from({ length: question.max - question.min + 1 }).map(
    (_, i) => i + question.min,
  );
  const nRS = anR.slice(1).reduce((acc, r) => mod(acc + r, L), BigInt(0));
  const nR0 = anR[0];

  let azBlankProof : Array<tProof> = [];
  if (m[0] === 0) {
    azBlankProof = blankProofs(state, hPublicCredential, pY, aCiphertexts, pAlphaS, pBetaS, nR0);
  } else {
    azBlankProof = blankProofs(state, hPublicCredential, pY, aCiphertexts, pAlpha0, pBeta0, nRS);
  }


  return {
    choices: aCiphertexts.map(serializeCiphertext),
    individual_proofs: aIndividualProofs,
    overall_proof: [],
    blank_proof: azBlankProof.map(serializeProof)
  };
}

function signature(nPriv: bigint, sHash: string) {
  const w = rand();
  const pA = g.multiply(w);

  // TODO: Refactor using Hsignature
  // TODO: nChallenge = Hsignature(hash, pA);
  const hashSignature = sjcl.codec.hex.fromBits(
    sjcl.hash.sha256.hash(`sig|${sHash}|${rev(pA.toHex())}`),
  );
  const nChallenge = mod(BigInt("0x" + hashSignature), L);
  const nResponse = mod(w - nPriv * nChallenge, L);

  return {
    hash: sHash,
    proof: serializeProof({ nChallenge, nResponse }),
  };
}

function deriveCredential(state: any, sPriv: string) {
  const prefix = `derive_credential|${state.setup.payload.election.uuid}`;

  const x0 = sjcl.codec.hex.fromBits(
    sjcl.hash.sha256.hash(`${prefix}|0|${sPriv}`),
  );

  const x1 = sjcl.codec.hex.fromBits(
    sjcl.hash.sha256.hash(`${prefix}|1|${sPriv}`),
  );

  const nPrivateCredential = mod(BigInt("0x" + x0 + x1), L);
  const pPublicCredential = g.multiply(nPrivateCredential);
  const hPublicCredential = rev(pPublicCredential.toHex());

  return {
    nPrivateCredential,
    hPublicCredential,
  };
}