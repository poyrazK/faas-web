import { api, unwrap } from './client';
import type { paths } from './schema';

export type SalesInquiryInput =
  paths['/v1/sales/inquiries']['post']['requestBody']['content']['application/json'];
export const prepareSalesInquiry = () => unwrap(api.GET('/v1/sales/inquiries/challenge'));
export const submitSalesInquiry = (body: SalesInquiryInput) =>
  unwrap(api.POST('/v1/sales/inquiries', { body }));
