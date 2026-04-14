import React, { useState } from 'react';

interface FloatingAction {
  label: string;
  icon: string;
  color: string;
  onClick: () => void;
}

interface FloatingAddButtonProps {
  actions: FloatingAction[];
}

const FloatingAddButton: React.FC<FloatingAddButtonProps> = ({ actions }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-20 z-40"
          onClick={() => setIsOpen(false)}
        />
      )}

      {isOpen && (
        <div className="fixed bottom-28 md:bottom-24 right-6 z-50 space-y-3">
          {actions.map((action) => (
            <button
              key={action.label}
              onClick={() => { action.onClick(); setIsOpen(false); }}
              className="flex items-center gap-3 bg-white shadow-lg rounded-full px-5 py-3 hover:bg-beige transition"
            >
              <span className="text-navy font-medium text-sm">{action.label}</span>
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-white text-lg"
                style={{ backgroundColor: action.color }}
              >
                {action.icon}
              </div>
            </button>
          ))}
        </div>
      )}

      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed bottom-20 md:bottom-6 right-6 w-14 h-14 rounded-full shadow-lg flex items-center justify-center text-white text-2xl z-50 transition-all ${
          isOpen ? 'bg-gray-500 rotate-45' : 'bg-primary hover:scale-110'
        }`}
      >
        +
      </button>
    </>
  );
};

export default FloatingAddButton;
