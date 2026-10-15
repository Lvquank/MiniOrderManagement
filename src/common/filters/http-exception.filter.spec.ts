import { ArgumentsHost, Logger } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter', () => {
  const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const host = { switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({ url: '/products' }) }) } as ArgumentsHost;
  beforeEach(() => { jest.clearAllMocks(); });
  it('maps concurrent SKU unique violations to 409', () => {
    const error = new QueryFailedError('insert', [], Object.assign(new Error('private SQL detail'), { code: '23505' }));
    new HttpExceptionFilter().catch(error, host);
    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Product SKU already exists' }));
  });
  it('keeps internal database details out of the response', () => {
    const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    try {
      new HttpExceptionFilter().catch(new Error('private SQL detail'), host);
      expect(response.status).toHaveBeenCalledWith(500);
      expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Internal server error' }));
    } finally { logger.mockRestore(); }
  });
});
