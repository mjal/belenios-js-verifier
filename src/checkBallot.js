import sjcl from "sjcl";
import { ed25519 } from "@noble/curves/ed25519";
import { check, logError, assert } from "./utils.js";
import { g, L, rev, mod, isValidPoint, parsePoint } from "./math";

export default function (state, ballot) {
  check(
    "ballots",
    "election.uuid correspond to election uuid",
    state.setup.payload.election.uuid === ballot.payload.election_uuid,
  );

  checkIsCanonical(ballot);
  checkCredential(state, ballot);
  checkIsUnique(ballot);
  checkValidPoints(ballot);
  checkSignature(ballot);

  for (let i = 0; i < state.setup.payload.election.questions.length; i++)
  {
    const question = state.setup.payload.election.questions[i];
    if (question.type === "NonHomomorphic") {
      // TODO
      logError("ballots", "NonHomomorphic questions not implemented yet");
    } else {
      checkIndividualProofs(state, ballot, i);
      if (question.blank) {
        // TODO
        // checkBlankProof(state, ballot);
        // checkOverallProofWithBlank(state, ballot);
        logError("ballots", "Question with blank vote not implemented yet");
      } else {
        checkOverallProofWithoutBlank(state, ballot, i);
      }
    }
  }
}

function valuesForProofOfIntervalMembership(y, alpha, beta, transcripts, ms) {
  const values = [];

  for (let i = 0; i < transcripts.length; i++) {
    const m = ms[i];

    const nChallenge = BigInt(transcripts[i].challenge);
    const nResponse = BigInt(transcripts[i].response);

    const a = g.multiply(nResponse).add(alpha.multiply(nChallenge));
    const gPowerM =
      m === 0 ? ed25519.ExtendedPoint.ZERO : g.multiply(BigInt(m));
    const b = y
      .multiply(nResponse)
      .add(beta.add(gPowerM.negate()).multiply(nChallenge));

    values.push(a);
    values.push(b);
  }

  return values;
}

function hashWithoutSignature(ballot) {
  const copy = Object.assign({}, ballot.payload);
  delete copy.signature;
  const serialized = JSON.stringify(copy);
  const hash = sjcl.codec.base64.fromBits(sjcl.hash.sha256.hash(serialized));
  return hash.replace(/=+$/, "");
}

function checkIsCanonical(ballot) {
  // On most implementations, the order of the fields in the
  // serialization correspond to the order of insertion. This
  // is not guaranteed by the JSON standard, but it is guaranteed
  // by JSON.stringify in most implementations.
  const obj = {
    election_uuid: ballot.payload.election_uuid,
    election_hash: ballot.payload.election_hash,
    credential: ballot.payload.credential,
    answers: ballot.payload.answers.map((answer) => {
      let obj = {};
      if (answer.choices.length === undefined) {
        obj.choices = {
          alpha: answer.choices.alpha,
          beta: answer.choices.beta,
        };
      } else {
        obj.choices = answer.choices.map((choice) => {
          return {
            alpha: choice.alpha,
            beta: choice.beta,
          };
        });
      }
      if (answer.proof) {
        obj.proof = {
          challenge: answer.proof.challenge,
          response: answer.proof.response,
        };
      }
      if (answer.individual_proofs) {
        obj.individual_proofs = answer.individual_proofs.map((iproof) => {
          return iproof.map((proof) => {
            return {
              challenge: proof.challenge,
              response: proof.response,
            };
          });
        });
      }
      if (answer.overall_proof) {
        obj.overall_proof = answer.overall_proof.map((proof) => {
          return {
            challenge: proof.challenge,
            response: proof.response,
          };
        });
      }
      if (answer.blank_proof !== undefined) {
        obj.blank_proof = answer.blank_proof.map((proof) => {
          return {
            challenge: proof.challenge,
            response: proof.response,
          };
        });
      }
      return obj;
    }),
    signature: ballot.payload.signature,
  };
  check(
    "ballots",
    "Is canonical",
    sjcl.codec.hex.fromBits(sjcl.hash.sha256.hash(JSON.stringify(obj))) ===
      ballot.payloadHash,
  );
}

function checkCredential(state, ballot) {
  const credentials = state.setup.credentialsWeights.map((cw) => cw.credential);
  check(
    "ballots",
    "Has a valid credential",
    credentials.indexOf(ballot.payload.credential) !== -1,
  );
}

const processedBallots = {};
function checkIsUnique(ballot) {
  check(
    "ballots",
    "Is unique",
    processedBallots[ballot.payloadHash] === undefined,
  );
  processedBallots[ballot.payloadHash] = ballot;
}

export function checkSignature(ballot) {
  check(
    "ballots",
    "Hash without signature is correct",
    ballot.payload.signature.hash === hashWithoutSignature(ballot),
  );

  const credential = parsePoint(ballot.payload.credential);
  const signature = ballot.payload.signature;
  const nChallenge = BigInt(signature.proof.challenge);
  const nResponse = BigInt(signature.proof.response);
  const pA = g.multiply(nResponse).add(credential.multiply(nChallenge));
  const verificationHash = sjcl.codec.hex.fromBits(
    sjcl.hash.sha256.hash(`sig|${signature.hash}|${rev(pA.toHex())}`),
  );

  const hexReducedVerificationHash = mod(
    BigInt("0x" + verificationHash),
    L,
  ).toString(16);

  check(
    "ballots",
    "Valid signature",
    nChallenge.toString(16) === hexReducedVerificationHash,
  );
}

export function checkValidPoints(ballot) {
  const answers = ballot.payload.answers;
  for (let i = 0; i < answers.length; i++) {
    for (let j = 0; j < answers[i].choices.length; j++) {
      const pAlpha = parsePoint(answers[i].choices[j].alpha);
      const pBeta = parsePoint(answers[i].choices[j].beta);
      check(
        "ballots",
        "Encrypted choices alpha,beta are valid curve points",
        isValidPoint(pAlpha) && isValidPoint(pBeta),
      );
    }
  }
}

export function checkIndividualProofs(state, ballot, idx) {
  const pY = parsePoint(state.setup.payload.election.public_key);
  const question = state.setup.payload.election.questions[idx];
  const answer = ballot.payload.answers[idx];
  const choices = answer.choices;
  const individualProofs = answer.individual_proofs;

  check(
    "ballots",
    "Has a proof for every answer answers",
    individualProofs.length ===
      question.answers.length + (question.blank ? 1 : 0),
  );

  for (let j = 0; j < individualProofs.length; j++) {
    const pAlpha = parsePoint(choices[j].alpha);
    const pBeta = parsePoint(choices[j].beta);

    let nSumChallenges = 0n;
    for (let k = 0; k < individualProofs[j].length; k++) {
      const challenge = BigInt(individualProofs[j][k].challenge);
      nSumChallenges = mod(nSumChallenges + challenge, L);
    }

    const values = valuesForProofOfIntervalMembership(
      pY,
      pAlpha,
      pBeta,
      individualProofs[j],
      [0, 1],
    );

    const S = `${state.setup.fingerprint}|${ballot.payload.credential}`;
    let sChallenge = `prove|${S}|${choices[j].alpha},${choices[j].beta}|`;
    sChallenge += values.map((v) => rev(v.toHex())).join(",");

    const hVerification = sjcl.codec.hex.fromBits(
      sjcl.hash.sha256.hash(sChallenge),
    );
    const hReducedVerification = mod(
      BigInt("0x" + hVerification),
      L,
    ).toString(16);

    check(
      "ballots",
      "Valid individual proof",
      nSumChallenges.toString(16) === hReducedVerification,
    );
  }
}

export function checkOverallProofWithoutBlank(state, ballot, idx) {
  const pY = parsePoint(state.setup.payload.election.public_key);
  const question = state.setup.payload.election.questions[idx];
  const answer = ballot.payload.answers[idx];

  const sumc = {
    alpha: ed25519.ExtendedPoint.ZERO,
    beta: ed25519.ExtendedPoint.ZERO,
  };

  for (let j = 0; j < answer.choices.length; j++) {
    sumc.alpha = sumc.alpha.add(parsePoint(answer.choices[j].alpha));
    sumc.beta = sumc.beta.add(parsePoint(answer.choices[j].beta));
  }

  let nSumChallenges = 0n;
  for (let k = 0; k < answer.overall_proof.length; k++) {
    const challenge = BigInt(answer.overall_proof[k].challenge);
    nSumChallenges = mod(nSumChallenges + challenge, L);
  }

  const min = question.min;
  const max = question.max;
  const ms = [];
  for (let j = min; j <= max; j++) {
    ms.push(j);
  }
  const values = valuesForProofOfIntervalMembership(
    pY,
    sumc.alpha,
    sumc.beta,
    answer.overall_proof,
    ms,
  );

  let sChallenge = "prove|";
  sChallenge += `${state.setup.fingerprint}|${ballot.payload.credential}|`;
  const alphasBetas = [];
  for (let j = 0; j < answer.choices.length; j++) {
    alphasBetas.push(`${answer.choices[j].alpha},${answer.choices[j].beta}`);
  }
  sChallenge += alphasBetas.join(",");
  sChallenge += `|${rev(sumc.alpha.toHex())},${rev(sumc.beta.toHex())}|`;
  sChallenge += values.map((v) => rev(v.toHex())).join(",");

  const hVerification = sjcl.codec.hex.fromBits(
    sjcl.hash.sha256.hash(sChallenge),
  );
  const hReducedVerification = mod(BigInt("0x" + hVerification), L).toString(
    16,
  );

  check(
    "ballots",
    "Valid overall proof (without blank vote)",
    nSumChallenges.toString(16) === hReducedVerification,
  );
}
