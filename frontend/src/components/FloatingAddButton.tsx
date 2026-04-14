import React, { useState } from 'react';

interface FloatingAddButtonProps {
  onAddAccount: () => void;
  onAddTransaction: () => void;
}

const FloatingAddButton: React.FC<FloatingAddButtonProps> = ({ onAddAccount, onAddTransaction }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-25 z-40"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Menu Options */}
      {isOpen && (
        <div className="fixed bottom-24 right-6 z-50 space-y-3">
          <button
            onClick={() => {
              onAddTransaction();
              setIsOpen(false);
            }}
            className="flex items-center gap-3 bg-white shadow-lg rounded-full px-6 py-3 hover:bg-beige transition group"
          >
            <span className="text-navy font-medium">Add Transaction</span>
            <div className="w-10 h-10 bg-accent rounded-full flex items-center justify-center text-white text-xl">
              💸
            </div>
          </button>

          <button
            onClick={() => {
              onAddAccount();
              setIsOpen(false);
            }}
            className="flex items-center gap-3 bg-white shadow-lg rounded-full px-6 py-3 hover:bg-beige transition group"
          >
            <span className="text-navy font-medium">Add Account</span>
            <div className="w-10 h-10 bg-lime rounded-full flex items-center justify-center text-primary text-xl">
              🏦
            </div>
          </button>
        </div>
      )}

      {/* Main Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed bottom-6 right-6 w-16 h-16 rounded-full shadow-lg flex items-center justify-center text-white text-3xl z-50 transition-transform ${
          isOpen ? 'bg-gray rotate-45' : 'bg-primary hover:scale-110'
        }`}
      >
        +
      </button>
    </>
  );
};

export default FloatingAddButton;