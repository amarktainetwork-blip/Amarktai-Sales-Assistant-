import { listCustomerDirectory, getExactCustomerDetail } from "./customerData";
/** Legacy bounded response; directory and detail share the canonical scoped queries. */
export async function listPersonalCrmCustomers(input: {
  userId: number;
  organisationId: number;
}) {
  const page = await listCustomerDirectory({
    ...input,
    page: 1,
    pageSize: 100,
  });
  const results = await Promise.all(
    page.items.map(contact =>
      getExactCustomerDetail({ ...input, contactId: contact.id })
    )
  );
  return results.filter((row): row is NonNullable<typeof row> => row !== null);
}
