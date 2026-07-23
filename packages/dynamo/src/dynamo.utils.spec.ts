import { describe, expect, it } from 'vitest';
import { stripDynamoKeys } from './dynamo.utils.js';

describe('stripDynamoKeys', () => {
  it('removes every DynamoDB key/index attribute', () => {
    const item = {
      id: 'abc',
      name: 'Chocolate',
      PK: 'THING#abc',
      SK: 'META',
      GSI1PK: 'THINGTYPE#food',
      GSI1SK: 'THING#Chocolate',
      GSI2PK: 'STATUS#pending',
      GSI2SK: 'CONTRIB#2026',
    };

    expect(stripDynamoKeys(item)).toEqual({ id: 'abc', name: 'Chocolate' });
  });

  it('is a no-op when none of the key attributes are present', () => {
    const item = { id: 'abc', name: 'Chocolate' };
    expect(stripDynamoKeys(item)).toEqual(item);
  });
});
