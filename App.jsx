import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, collection, query, onSnapshot, updateDoc, addDoc } from 'firebase/firestore';
import { setLogLevel } from 'firebase/firestore';

setLogLevel('Debug');

const useFirebaseSetup = () => {
  const [db, setDb] = useState(null);
  const [userId, setUserId] = useState(null);
  const [appId, setAppId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  useEffect(() => {
    try {
      const currentAppId = typeof __app_id !== 'undefined' ? __app_id : 'default-trello-app';
      const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
      const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

      if (Object.keys(firebaseConfig).length === 0) return;

      const app = initializeApp(firebaseConfig);
      const firestore = getFirestore(app);
      const firebaseAuth = getAuth(app);

      setDb(firestore);
      setAppId(currentAppId);

      const performAuth = async () => {
        try {
          if (initialAuthToken) await signInWithCustomToken(firebaseAuth, initialAuthToken);
          else await signInAnonymously(firebaseAuth);
        } catch (error) {
          console.error("Firebase Auth Error:", error);
        }
      };
      performAuth();

      const unsubscribe = onAuthStateChanged(firebaseAuth, user => {
        setUserId(user ? user.uid : null);
        setIsAuthReady(true);
      });
      return () => unsubscribe();
    } catch (e) {
      console.error("Failed to initialize Firebase:", e);
    }
  }, []);

  return { db, userId, appId, isAuthReady };
};

const getJaccardSimilarity = (text1, text2) => {
  const normalize = text => {
    const stopWords = new Set(['a', 'the', 'is', 'of', 'and', 'to', 'in', 'for', 'with', 'on', 'my']);
    return new Set(text.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "").split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w)));
  };
  const setA = normalize(text1);
  const setB = normalize(text2);
  if (setA.size === 0 || setB.size === 0) return 0;
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
};

const getSmartRecommendations = (card, allCards) => {
  const recs = [];
  const content = (card.title + ' ' + (card.description || '')).toLowerCase();
  const currentList = card.listTitle;
  if (!card.dueDate) {
    let date = null, rationale = '';
    if (content.includes('today') || content.includes('urgent') || content.includes('asap')) {
      date = new Date(); rationale = 'Based on urgent keywords.';
    } else if (content.includes('tomorrow') || content.includes('next day')) {
      date = new Date(); date.setDate(date.getDate() + 1); rationale = 'Based on short-term keywords.';
    } else if (content.includes('next week') || content.includes('7 days')) {
      date = new Date(); date.setDate(date.getDate() + 7); rationale = 'Based on medium-term keywords.';
    }
    if (date) {
      const action = date.toISOString().split('T')[0];
      recs.push({ type: 'date', text: `Suggest Due Date: ${action}`, action, rationale });
    }
  }
  if (currentList.includes('To Do') && (content.includes('started') || content.includes('working on'))) {
    recs.push({ type: 'move', text: 'Suggest Move: In Progress', action: 'In Progress', rationale: 'Keywords suggest work has begun.' });
  } else if (currentList.includes('In Progress') && (content.includes('done') || content.includes('complete'))) {
    recs.push({ type: 'move', text: 'Suggest Move: Done', action: 'Done', rationale: 'Keywords suggest task is complete.' });
  }
  const relatedCards = allCards.filter(c => c.id !== card.id).map(otherCard => {
    const similarity = getJaccardSimilarity(content, otherCard.title + ' ' + (otherCard.description || ''));
    return { card: otherCard, similarity };
  }).filter(item => item.similarity > 0.25).sort((a, b) => b.similarity - a.similarity).slice(0, 3);
  if (relatedCards.length > 0) {
    recs.push({ type: 'related', text: 'Suggested Related Cards:', cards: relatedCards, rationale: 'Content similarity analysis.' });
  }
  return recs;
};

const CardModal = ({ card, lists, onClose, updateCard, allCards, userId, updateBoardMembers }) => {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description || '');
  const [dueDate, setDueDate] = useState(card.dueDate || '');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const recs = useMemo(() => getSmartRecommendations(card, allCards), [card, allCards]);
  const handleSave = () => { updateCard(card.id, { title, description, dueDate }); onClose(); };
  const handleApplyRec = rec => {
    if (rec.type === 'date') {
      setDueDate(rec.action);
      updateCard(card.id, { dueDate: rec.action });
    } else if (rec.type === 'move') {
      const newList = lists.find(l => l.title === rec.action);
      if (newList) updateCard(card.id, { listId: newList.id });
    }
  };
  const handleInvite = () => {
    if (newMemberEmail && newMemberEmail !== card.board.ownerEmail) {
      updateBoardMembers(newMemberEmail);
      setNewMemberEmail('');
    }
  };
  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <button onClick={onClose} className="modal-close-btn"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
        <div className="card-details-left">
          <h2 className="card-details-title">Task Details</h2>
          <input type="text" className="card-title-input" value={title} onChange={e => setTitle(e.target.value)} />
          <div className="input-group">
            <label className="input-label">Description</label>
            <textarea className="card-description-input" placeholder="Add a detailed description..." value={description} onChange={e => setDescription(e.target.value)}></textarea>
          </div>
          <div className="input-flex">
            <label className="input-label">Due Date</label>
            <input type="date" className="date-input" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>
          <div className="pt-4"><button onClick={handleSave} className="save-button">Save Changes</button></div>
        </div>
        <div className="recommendations-panel">
          <h3 className="panel-subtitle-collab">Collaborators</h3>
          <p className="panel-text">Board ID:<span className="mono-id">{card.board.id}</span></p>
          <p className="panel-text">Your User ID:<span className="mono-id">{userId}</span></p>
          <div className="invite-form">
            <input type="email" placeholder="Invite user email" className="invite-input" value={newMemberEmail} onChange={e => setNewMemberEmail(e.target.value)} />
            <button onClick={handleInvite} className="invite-button">Invite to Board</button>
          </div>
          <h3 className="panel-subtitle-recs">Smart Recommendations</h3>
          <div className="recs-list">
            {recs.length > 0 ? recs.map((rec, index) => (
              <div key={index} className="recommendation-item">
                <p className="recs-rationale">{rec.rationale}</p>
                {rec.type === 'related' ? (<div className="related-cards-list">{rec.cards.map(rc => (<p key={rc.card.id} className="related-card-text">💡 {rc.card.title}({(rc.similarity * 100).toFixed(0)}%)</p>))}</div>) : (<button onClick={() => handleApplyRec(rec)} className="recs-action-button">{rec.text}</button>)}
              </div>
            )) : (<p className="recs-none">No smart recommendations for this card right now.</p>)}
          </div>
        </div>
      </div>
    </div>
  );
};

const BoardView = ({ board, cards, lists, userId, db, appId }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedCard, setSelectedCard] = useState(null);
  const getDocRef = useCallback((collectionName, docId) => doc(db, 'artifacts', appId, 'public/data', collectionName, docId), [db, appId]);
  const updateCard = useCallback(async (cardId, updates) => {
    if (!db) return;
    try { await updateDoc(getDocRef('cards', cardId), updates); } catch (e) { console.error('Error updating card:', e); }
  }, [db, getDocRef]);
  const updateBoardMembers = useCallback(async email => {
    if (!db) return;
    try {
      const boardRef = getDocRef('boards', board.id);
      await updateDoc(boardRef, { members: [...(board.members || []), email] });
    } catch (e) { console.error('Error inviting user:', e); }
  }, [db, board, getDocRef]);
  const handleCardClick = card => {
    setSelectedCard({ ...card, board: { id: board.id, ownerEmail: board.ownerEmail } });
    setIsModalOpen(true);
  };
  const addCard = async listId => {
    if (!db || !userId) return;
    try {
      await addDoc(collection(db, 'artifacts', appId, 'public/data/cards'), {
        title: 'New Task', description: 'Add details here...', boardId: board.id, listId, createdBy: userId, createdAt: new Date().toISOString()
      });
    } catch (e) { console.error('Error adding card:', e); }
  };
  if (!board) return <div className="board-placeholder">Select or Create a Board to get started.</div>;
  return (
    <div className="main-board-container">
      <header className="board-header">
        <h1 className="board-title">{board.name}</h1>
        <p className="board-info">Owner:{board.ownerEmail}|Members:{board.members?.join(', ')||'None'}</p>
      </header>
      <div className="list-container">
        {lists.map(list => (
          <div key={list.id} className="list-column">
            <h3 className="list-title">{list.title}</h3>
            <div className="card-list-scroll">
              {cards.filter(c => c.listId === list.id).map(card => (
                <div key={card.id} className="task-card" onClick={() => handleCardClick({ ...card, listTitle: list.title })}>
                  <p className="card-text">{card.title}</p>
                  {card.dueDate && (<p className={`card-due-date ${new Date(card.dueDate) < new Date() ? 'due-late' : 'due-ok'}`}>Due:{new Date(card.dueDate).toLocaleDateString()}</p>)}
                </div>
              ))}
            </div>
            <button onClick={() => addCard(list.id)} className="add-card-button">+ Add Card</button>
          </div>
        ))}
      </div>
      {isModalOpen && selectedCard && (
        <CardModal card={selectedCard} lists={lists} allCards={cards} onClose={() => setIsModalOpen(false)} updateCard={updateCard} userId={userId} updateBoardMembers={updateBoardMembers} />
      )}
    </div>
  );
};

const App = () => {
  const { db, userId, appId, isAuthReady } = useFirebaseSetup();
  const [boards, setBoards] = useState([]);
  const [selectedBoardId, setSelectedBoardId] = useState(null);
  const [cards, setCards] = useState([]);
  const [newBoardName, setNewBoardName] = useState('');
  const selectedBoard = boards.find(b => b.id === selectedBoardId);
  const defaultLists = useMemo(() => [
    { id: 'todo', title: 'To Do', order: 1 },
    { id: 'in_progress', title: 'In Progress', order: 2 },
    { id: 'done', title: 'Done', order: 3 }
  ], []);
  useEffect(() => {
    if (!db || !isAuthReady) return;
    const boardCollectionRef = collection(db, 'artifacts', appId, 'public/data/boards');
    const unsubscribeBoards = onSnapshot(query(boardCollectionRef), snapshot => {
      const fetchedBoards = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const userBoards = fetchedBoards.filter(b => b.ownerId === userId || b.members?.includes(userId));
      setBoards(userBoards);
      if (userBoards.length > 0 && !selectedBoardId) setSelectedBoardId(userBoards[0].id);
    }, e => console.error("Error listening to boards:", e));
    const unsubscribeCards = onSnapshot(collection(db, 'artifacts', appId, 'public/data/cards'), snapshot => {
      const fetchedCards = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(card => card.boardId === selectedBoardId);
      setCards(fetchedCards);
    }, e => console.error("Error listening to cards:", e));
    return () => { unsubscribeBoards(); unsubscribeCards(); };
  }, [db, isAuthReady, appId, userId, selectedBoardId]);
  const createNewBoard = async () => {
    if (!db || !userId || !newBoardName) return;
    try {
      const docRef = await addDoc(collection(db, 'artifacts', appId, 'public/data/boards'), {
        name: newBoardName, ownerId: userId, ownerEmail: userId, members: [], createdAt: new Date().toISOString()
      });
      setSelectedBoardId(docRef.id);
      setNewBoardName('');
    } catch (e) { console.error("Error creating board:", e); }
  };
  if (!isAuthReady) return <div className="loading-screen">Loading application...</div>;
  return (
    <div className="app-container">
      <style>{`
        .app-container {
          min-height: 100vh;
          background-color: #f9fafb;
          font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
          display: flex;
          flex-direction: column;
        }
        .card-list-scroll::-webkit-scrollbar, .list-container::-webkit-scrollbar {
          height: 8px;
          width: 8px;
        }
        .card-list-scroll::-webkit-scrollbar-thumb, .list-container::-webkit-scrollbar-thumb {
          background-color: #cbd5e1;
          border-radius: 4px;
        }
        .main-header {
          background-color: #fff;
          box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06);
          padding: 1rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
          position: sticky;
          top: 0;
          z-index: 10;
        }
        .app-logo {
          font-size: 1.5rem;
          font-weight: 900;
          color: #4f46e5;
        }
        .user-info {
          font-size: 0.875rem;
          color: #6b7280;
          font-weight: 500;
        }
        .user-id-mono {
          font-family: monospace;
          color: #6366f1;
        }
        .main-flex {
          display: flex;
          flex-grow: 1;
        }
        .sidebar {
          width: 16rem;
          background-color: #fff;
          padding: 1rem;
          border-right: 1px solid #e5e7eb;
          flex-shrink: 0;
        }
        .sidebar-title {
          font-size: 1.125rem;
          font-weight: 700;
          color: #1f2937;
          margin-bottom: 1rem;
          padding-bottom: 0.5rem;
          border-bottom: 1px solid #e5e7eb;
        }
        .board-button {
          width: 100%;
          text-align: left;
          padding: 0.5rem;
          border-radius: 0.5rem;
          transition: background-color 150ms;
          font-size: 0.875rem;
          color: #4b5563;
        }
        .board-button:hover {
          background-color: #f3f4f6;
        }
        .board-button.selected {
          background-color: #e0e7ff;
          color: #3730a3;
          font-weight: 600;
          border-left: 4px solid #6366f1;
        }
        .board-creation-area {
          margin-top: 1.5rem;
          padding-top: 1rem;
          border-top: 1px solid #e5e7eb;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .board-input {
          padding: 0.5rem;
          border: 1px solid #d1d5db;
          border-radius: 0.5rem;
          font-size: 0.875rem;
        }
        .create-board-btn {
          padding: 0.5rem;
          background-color: #6366f1;
          color: #fff;
          border-radius: 0.5rem;
          font-weight: 500;
          font-size: 0.875rem;
          transition: background-color 150ms;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        }
        .create-board-btn:hover {
          background-color: #4f46e5;
        }
        .create-board-btn:disabled {
          background-color: #a5b4fc;
        }
        .main-board-container {
          padding: 1rem 2rem;
          flex-grow: 1;
          overflow: hidden;
        }
        .board-header {
          margin-bottom: 1.5rem;
          padding-bottom: 1rem;
          border-bottom: 1px solid #e5e7eb;
        }
        .board-title {
          font-size: 1.875rem;
          font-weight: 800;
          color: #1f2937;
        }
        .board-info {
          font-size: 0.875rem;
          color: #6b7280;
          margin-top: 0.25rem;
        }
        .list-container {
          display: flex;
          gap: 1.5rem;
          overflow-x: auto;
          height: calc(100vh - 160px);
          padding-bottom: 1rem;
        }
        .list-column {
          width: 18rem;
          flex-shrink: 0;
          background-color: #f3f4f6;
          border-radius: 0.75rem;
          padding: 0.75rem;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
          display: flex;
          flex-direction: column;
          height: 100%;
        }
        .list-title {
          font-size: 1.125rem;
          font-weight: 700;
          color: #1f2937;
          margin-bottom: 1rem;
          padding: 0.25rem 0.5rem;
          border-bottom: 2px solid #a5b4fc;
        }
        .card-list-scroll {
          flex-grow: 1;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          overflow-y: auto;
          padding-right: 0.25rem;
        }
        .task-card {
          background-color: #fff;
          padding: 0.5rem;
          border-radius: 0.5rem;
          box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
          cursor: pointer;
          transition: box-shadow 150ms;
          border-left: 4px solid #6366f1;
        }
        .task-card:hover {
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        }
        .card-text {
          font-weight: 500;
          color: #1f2937;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .card-due-date {
          font-size: 0.75rem;
          margin-top: 0.25rem;
          font-weight: 600;
        }
        .due-late { color: #ef4444; }
        .due-ok { color: #10b981; }
        .add-card-button {
          margin-top: 1rem;
          width: 100%;
          padding: 0.5rem;
          font-size: 0.875rem;
          color: #4f46e5;
          background-color: #eef2ff;
          border-radius: 0.5rem;
          transition: background-color 150ms;
          font-weight: 500;
        }
        .add-card-button:hover {
          background-color: #e0e7ff;
        }
        .modal-overlay {
          position: fixed;
          inset: 0;
          background-color: rgba(17, 24, 39, 0.75);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1rem;
          z-index: 50;
        }
        .modal-content {
          background-color: #fff;
          border-radius: 0.75rem;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
          width: 100%;
          max-width: 48rem;
          padding: 1.5rem;
          position: relative;
          display: flex;
          gap: 1.5rem;
        }
        @media (max-width: 768px) {
          .modal-content {
            flex-direction: column;
          }
        }
        .modal-close-btn {
          position: absolute;
          top: 1rem;
          right: 1rem;
          color: #6b7280;
          transition: color 150ms;
        }
        .modal-close-btn:hover {
          color: #1f2937;
        }
        .card-details-left {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .card-details-title {
          font-size: 1.875rem;
          font-weight: 800;
          color: #1f2937;
          padding-bottom: 0.5rem;
          border-bottom: 1px solid #e5e7eb;
        }
        .card-title-input {
          width: 100%;
          font-size: 1.25rem;
          font-weight: 600;
          border-bottom: 2px solid #818cf8;
          padding: 0.5rem;
          outline: none;
          border-radius: 0.375rem 0.375rem 0 0;
          transition: border-color 150ms;
        }
        .card-title-input:focus {
          border-color: #4f46e5;
        }
        .input-group {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        .input-label {
          font-size: 0.875rem;
          font-weight: 500;
          color: #4b5563;
        }
        .card-description-input {
          width: 100%;
          height: 8rem;
          padding: 0.75rem;
          border: 1px solid #d1d5db;
          border-radius: 0.5rem;
          resize: none;
          transition: border-color 150ms;
        }
        .card-description-input:focus, .date-input:focus {
          border-color: #6366f1;
          outline: none;
          box-shadow: 0 0 0 1px #6366f1;
        }
        .input-flex {
          display: flex;
          align-items: center;
          gap: 1rem;
        }
        .date-input {
          padding: 0.5rem;
          border: 1px solid #d1d5db;
          border-radius: 0.5rem;
          transition: border-color 150ms;
        }
        .save-button {
          width: 100%;
          padding: 0.75rem 1rem;
          background-color: #4f46e5;
          color: #fff;
          font-weight: 700;
          border-radius: 0.5rem;
          transition: background-color 200ms, transform 200ms;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
        }
        .save-button:hover {
          background-color: #4338ca;
          transform: scale(1.01);
        }
        .recommendations-panel {
          width: 18rem;
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        .panel-subtitle-collab, .panel-subtitle-recs {
          font-size: 1.25rem;
          font-weight: 800;
          padding-bottom: 0.25rem;
          border-bottom: 1px solid #c7d2fe;
          color: #4338ca;
        }
        .panel-subtitle-recs {
          margin-top: 1.5rem;
        }
        .panel-text {
          font-size: 0.875rem;
          color: #6b7280;
        }
        .mono-id {
          font-family: monospace;
          font-size: 0.75rem;
          background-color: #f3f4f6;
          padding: 2px 4px;
          border-radius: 0.25rem;
        }
        .invite-form {
          margin-top: 0.5rem;
          padding: 0.75rem;
          background-color: #eef2ff;
          border-radius: 0.5rem;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .invite-input {
          width: 100%;
          padding: 0.5rem;
          border: 1px solid #c7d2fe;
          border-radius: 0.5rem;
          font-size: 0.875rem;
        }
        .invite-button {
          width: 100%;
          font-size: 0.875rem;
          padding: 0.25rem 0.5rem;
          background-color: #818cf8;
          color: #fff;
          border-radius: 0.5rem;
          transition: background-color 150ms;
        }
        .invite-button:hover {
          background-color: #6366f1;
        }
        .recs-list {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        .recommendation-item {
          padding: 0.75rem;
          background-color: #fffbeb;
          border: 1px solid #fde68a;
          border-radius: 0.5rem;
          box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
        }
        .recs-rationale {
          font-size: 0.75rem;
          color: #6b7280;
          margin-bottom: 0.25rem;
          font-style: italic;
        }
        .related-cards-list {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        .related-card-text {
          font-size: 0.875rem;
          font-weight: 500;
          color: #b45309;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .recs-action-button {
          width: 100%;
          font-size: 0.875rem;
          padding: 0.25rem 0.5rem;
          background-color: #fcd34d;
          color: #78350f;
          border-radius: 0.375rem;
          transition: background-color 150ms;
          font-weight: 700;
        }
        .recs-action-button:hover {
          background-color: #fbbf24;
        }
        .recs-none {
          font-size: 0.875rem;
          color: #6b7280;
          font-style: italic;
        }
        .loading-screen, .board-placeholder {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          font-size: 1.25rem;
          font-weight: 500;
          color: #4f46e5;
          background-color: #f9fafb;
          padding: 2rem;
          text-align: center;
        }
      `}</style>
      <header className="main-header">
        <h1 className="app-logo">Smart Kanban</h1>
        <div className="user-info">Logged in User ID:<span className="user-id-mono">{userId || 'N/A'}</span></div>
      </header>
      <div className="main-flex">
        <aside className="sidebar">
          <h2 className="sidebar-title">Your Boards</h2>
          <div className="space-y-2">
            {boards.map(board => (
              <button key={board.id} className={`board-button ${selectedBoardId === board.id ? 'selected' : ''}`} onClick={() => setSelectedBoardId(board.id)}>{board.name}</button>
            ))}
          </div>
          <div className="board-creation-area">
            <input type="text" placeholder="New Board Name" value={newBoardName} onChange={e => setNewBoardName(e.target.value)} className="board-input" />
            <button onClick={createNewBoard} disabled={!newBoardName} className="create-board-btn">Create Board</button>
          </div>
        </aside>
        <main className="main-board-content">
          <BoardView board={selectedBoard} cards={cards} lists={defaultLists} userId={userId} db={db} appId={appId} />
        </main>
      </div>
    </div>
  );
};
export default App;