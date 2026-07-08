/**
 * Live integration test for the airline Code tools — executes the EXACT code
 * shipped to Vapi against real Supabase (status → alternatives → rebook) plus
 * the pure compensation calc.
 *
 *   npm run test:flight
 */
import { env } from "../config.js";
import { GET_FLIGHT_STATUS_CODE, FIND_ALTERNATIVES_CODE, CONFIRM_REBOOK_CODE, COMPENSATION_CODE } from "../vapi/flight-code.js";
import { header, pretty } from "../utils/print.js";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as any;
if (!env.supabaseUrl || !env.supabaseServiceKey) throw new Error("Supabase env missing — fill meridian/.env");
const toolEnv = { SUPABASE_URL: env.supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: env.supabaseServiceKey };

const getStatus = new AsyncFunction("args", "env", GET_FLIGHT_STATUS_CODE);
const findAlt = new AsyncFunction("args", "env", FIND_ALTERNATIVES_CODE);
const confirmRebook = new AsyncFunction("args", "env", CONFIRM_REBOOK_CODE);
const compensation = new AsyncFunction("args", "env", COMPENSATION_CODE);

header("Airline Code tools — live integration");

const st = await getStatus({ flightNumber: "UA482", name: "Justin Crowe" }, toolEnv);
pretty("get_flight_status  UA482 / Justin Crowe", st);

const alts = await findAlt({ origin: st.origin, destination: st.destination }, toolEnv);
pretty("find_alternative_flights", alts);

const chosen = alts.options[0];
const rb = await confirmRebook(
  { bookingReference: st.bookingReference, newFlightNumber: chosen.flightNumber, newDepartureTime: chosen.departureTime },
  toolEnv
);
pretty(`confirm_rebook → ${chosen.flightNumber}`, rb);

// Pure calc — show a real disruption voucher (gold, 3h delay) regardless of UA482's roll.
const comp = await compensation({ delayMinutes: 180, loyaltyTier: "gold" }, toolEnv);
pretty("compensation_engine  (gold, 180 min)", comp);
const compCx = await compensation({ cancelled: true, loyaltyTier: "platinum" }, toolEnv);
pretty("compensation_engine  (platinum, cancelled)", compCx);
