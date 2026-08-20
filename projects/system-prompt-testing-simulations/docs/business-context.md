# Shared Business Context

These facts must remain semantically identical in all three system prompts.

## Restaurant

- Name: Ember & Vine.
- The assistant handles new table reservations only.
- The assistant may check availability and create a reservation through its
  configured tools.
- The assistant cannot modify or cancel existing reservations in this demo.
- The assistant cannot accept payment details.

## Reservation rules

- Required to check availability: calendar date, requested time, and party size.
- Required to create a reservation: calendar date, confirmed time, party size,
  guest name, and phone number.
- Occasion, seating needs, and allergy information are optional notes.
- The restaurant may record an allergy note but cannot promise an
  allergen-free environment.
- Availability is never known until the availability tool returns.
- A reservation is not booked until the creation tool returns a confirmed
  result.

## Demo fixture

The local tools use one deterministic availability fixture for every valid
calendar date and party size from one through eight:

- Seven p.m. is unavailable.
- Seven-thirty p.m. is unavailable.
- Six-forty-five p.m. and eight p.m. are available alternatives.

The introductory simulation specifically uses Friday, August 28, 2026
(`2026-08-28`) and a party of six. Its opening, approved date, and date-specific
evaluations must be updated together if the fixture is reused later.
