# Demo Tool Contracts

The implemented Vapi Code Tool creation payloads are in `../tools/`. No server
URL, authentication, environment variables, or external implementation is
required. Tool IDs will exist only after the reviewed payloads are created in
Vapi.

Both tools must be attached to all three assistants with byte-for-byte identical
descriptions, schemas, messages, and backend behavior.

## Check table availability

Machine-facing name: `check_table_availability`

Call when:

- The caller wants a new reservation.
- Calendar date, requested time, and party size are known.
- Availability has not already been checked for the current combination.
- Any of those three values changed after the last check.

Do not call when:

- The calendar date is ambiguous.
- Requested time or party size is missing.
- The caller is only asking a general question.

LLM-facing arguments:

- `reservationDate`: ISO date, `YYYY-MM-DD`.
- `requestedTime`: local restaurant time in twenty-four-hour `HH:mm` format.
- `partySize`: integer.

Representative minimal responses:

```json
{
  "available": true,
  "requestedTime": "20:00",
  "alternatives": []
}
```

```json
{
  "available": false,
  "requestedTime": "19:30",
  "alternatives": ["18:45", "20:00"]
}
```

The response should not contain secrets, internal logs, or fields the model does
not need.

## Create restaurant reservation

Machine-facing name: `create_restaurant_reservation`

Call when:

- The selected time was returned as available.
- The caller has directly approved the final date, time, and party size.
- Guest name and phone number are known.

Do not call when:

- Availability has not been checked for the current date, time, and party size.
- Required information is missing or ambiguous.
- The caller has not approved the final booking details.

LLM-facing arguments:

- `reservationDate`: ISO date, `YYYY-MM-DD`.
- `reservationTime`: local restaurant time in twenty-four-hour `HH:mm` format.
- `partySize`: integer.
- `guestName`: caller-provided name.
- `phoneNumber`: caller-provided phone number, normalized when possible.
- `occasion`: optional short note.
- `seatingNeeds`: optional short note.
- `allergyNotes`: optional short note.

Representative minimal success response:

```json
{
  "status": "confirmed",
  "confirmationCode": "EV-2048"
}
```

Representative minimal failure response:

```json
{
  "status": "failed",
  "reason": "slot_not_available"
}
```

The fixture independently validates required field formats, the supported party
size range, and that the selected time is available. The system prompt guides
the model's conversation and approval behavior; it is not the data-validation
boundary.

## Suggested tool messages

Use the same messages for every assistant:

- Availability request start: “Let me check that.”
- Booking request start: “One moment while I book that.”
- Tool failure: no success claim; let the assistant recover using the tool
  result.

## Deployment checks

- Confirm Code Tools are enabled for the Vapi organization used for the demo.
- Run `npm run validate` before deployment.
- Run `npm run push` to create or update the two tools, save their verified IDs,
  and attach the same IDs to all three assistants.
