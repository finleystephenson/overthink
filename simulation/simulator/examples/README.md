# Example tools

Both are rules-based, not AI. They exist to prove the loop and to show what a result looks like. They are deliberately naive, and what they get wrong is useful to read in the report.

## simple-responder.mjs (role `assistant`)

Answers customer contacts with keyword matches. In the 30-day example it does two things a careful person would not, and the report shows both:

- **It raises refunds, and that is correct behaviour, not a bug.** Customers who say "please cancel my order" get it cancelled at once, while the parcel is still unpacked, and the engine refunds them. In the staff-only run the same requests wait hours in the queue; by the time a person reads them many parcels have been packed and the engine refuses the cancellation. So the tool's refunds are higher (about £1,950 against £990 on cancellations in one seed). There is no double refund: a contact is handled by the tool or by staff, never both. Cancelled orders also give back their sale and stock, so this mostly moves revenue rather than destroying profit.
- **About 30 refused calls per run, all one mistake.** It calls `report_problem` for a faulty item without checking the message for a photo. The engine's rule says a photo is needed, so each call is refused (`rule_violation`) and counted as a rule break. The responder then hands the case to a person, so the customer is still looked after, but a better tool would ask for the photo first. We left it naive on purpose, so the report has a real mistake to show.

## simple-prospector.mjs (role `marketing`)

Writes a personalised message from each prospect's record, offers what they need at 5% off, uses the channel they prefer, and follows the outreach rules (so it makes no rule breaks).
