import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { HttpErrorFilter } from './http-error.filter';

function createResponseMock() {
  const response: Record<string, unknown> = {};
  response.status = jest.fn().mockReturnValue(response);
  response.json = jest.fn().mockReturnValue(response);
  response.setHeader = jest.fn();
  return response;
}

function createHost(response: Record<string, unknown>): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
}

describe('HttpErrorFilter', () => {
  it('sets Retry-After header for RATE_LIMITED responses', () => {
    const filter = new HttpErrorFilter();
    const response = createResponseMock();
    const host = createHost(response);
    const exception = new HttpException(
      {
        code: 'RATE_LIMITED',
        message: 'Too many attempts. Please try again later.',
        details: {
          retryAfterSeconds: 18,
        },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );

    filter.catch(exception, host);

    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '18');
    expect(response.status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
    expect(response.json).toHaveBeenCalledWith({
      error: 'Too many attempts. Please try again later.',
      message: 'Too many attempts. Please try again later.',
      code: 'RATE_LIMITED',
      details: {
        retryAfterSeconds: 18,
      },
    });
  });

  it('does not set Retry-After for non-429 errors', () => {
    const filter = new HttpErrorFilter();
    const response = createResponseMock();
    const host = createHost(response);
    const exception = new HttpException(
      {
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid credentials',
      },
      HttpStatus.UNAUTHORIZED,
    );

    filter.catch(exception, host);

    expect(response.setHeader).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
  });
});
