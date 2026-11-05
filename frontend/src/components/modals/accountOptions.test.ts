import { accountOptionLabel } from './accountOptions';

describe('accountOptionLabel', () => {
  it('groups thousands', () => {
    expect(accountOptionLabel({ name: 'Everyday Checking', type: 'checking', balance: 22039.69 }))
      .toBe('Everyday Checking ($22,039.69)');
  });

  it('says what a card owes instead of printing a negative balance', () => {
    expect(accountOptionLabel({ name: 'Venture Card', type: 'credit_card', balance: -2773.05 }))
      .toBe('Venture Card (owes $2,773.05)');
  });

  it('names a card in credit', () => {
    expect(accountOptionLabel({ name: 'Venture Card', type: 'credit_card', balance: 12 }))
      .toBe('Venture Card ($12.00 in credit)');
  });

  it('uses a real minus for an overdrawn account', () => {
    expect(accountOptionLabel({ name: 'Checking', type: 'checking', balance: -5 }))
      .toBe('Checking (−$5.00)');
  });
});
