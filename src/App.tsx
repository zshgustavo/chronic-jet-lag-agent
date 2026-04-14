import { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, ThinkingLevel, Chat, Type, FunctionDeclaration } from '@google/genai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Send, Map, Globe, Brain, Plane, User, Bot, Loader2 } from 'lucide-react';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SYSTEM_INSTRUCTION = `Objetivo e Metas:
* Atuar como um agente de viagens 'Viajantes' especializado, ajudando os usuários a planejar, organizar e reservar viagens personalizadas.
* Atuar como intermediário entre o usuário e fornecedores turísticos, como companhias aéreas e hotéis, utilizando ferramentas como Google Flights e Google Maps.
* Criar roteiros detalhados, sugerir hospedagens e garantir o melhor custo-benefício para viagens de lazer ou negócios.

Comportamentos e Regras:
1) Consulta Inicial:
a) Cumprimente o usuário calorosamente e apresente-se como o agente de viagens da 'Viajantes'.
b) Pergunte sobre o destino desejado, as datas da viagem e o orçamento estimado.
c) Questione sobre preferências específicas: tipo de acomodação (hotel, resort, hostel), classe de voo e interesses (gastronomia, aventura, relaxamento).

2) Pesquisa e Planejamento:
a) Utilize ferramentas de busca para encontrar as melhores opções de passagens aéreas e hospedagens.
b) Apresente pelo menos 3 opções de pacotes ou combinações, detalhando preços, horários e localizações.
c) Forneça consultoria sobre documentos necessários (vistos, passaportes) e dicas locais do destino.
d) Ao pesquisar voos, SEMPRE use a ferramenta searchFlights para obter preços e horários reais.

3) Suporte e Personalização:
a) Ajuste o roteiro conforme o feedback do usuário até que a viagem esteja perfeita.
b) Ofereça suporte informativo sobre como proceder em emergências comuns de viagem.

Tom de Voz Geral:
* Profissional, prestativo e inspirador.
* Use uma linguagem clara e organizada.
* Demonstre entusiasmo em ajudar o usuário a realizar a viagem dos sonhos.`;

const searchFlightsDeclaration: FunctionDeclaration = {
  name: "searchFlights",
  description: "Search for flights between two airports on specific dates using Google Flights.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      departureAirport: { type: Type.STRING, description: "3-letter IATA code of departure airport (e.g., JFK, GRU)" },
      arrivalAirport: { type: Type.STRING, description: "3-letter IATA code of arrival airport (e.g., LHR, CDG)" },
      date: { type: Type.STRING, description: "Departure date in YYYY-MM-DD format" },
      preferredAirline: { type: Type.STRING, description: "Optional preferred airline name" }
    },
    required: ["departureAirport", "arrivalAirport", "date"]
  }
};

type Message = {
  role: 'user' | 'model';
  text: string;
};

type AgentMode = 'search' | 'maps' | 'thinking';

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<AgentMode>('search');
  
  const chatRef = useRef<Chat | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Initialize chat when mode changes
  useEffect(() => {
    let model = 'gemini-3-flash-preview';
    let config: any = {
      systemInstruction: SYSTEM_INSTRUCTION,
    };

    if (mode === 'search') {
      config.tools = [
        { googleSearch: {} },
        { functionDeclarations: [searchFlightsDeclaration] }
      ];
      config.toolConfig = { includeServerSideToolInvocations: true };
    } else if (mode === 'maps') {
      config.tools = [{ googleMaps: {} }];
    } else if (mode === 'thinking') {
      model = 'gemini-3.1-pro-preview';
      config.thinkingConfig = { thinkingLevel: ThinkingLevel.HIGH };
    }

    chatRef.current = ai.chats.create({
      model,
      config,
    });
    
    // Clear messages when switching modes to start fresh with the new tools/model
    setMessages([]);
  }, [mode]);

  const handleSend = async () => {
    if (!input.trim() || !chatRef.current || isLoading) return;

    const userText = input.trim();
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text: userText }]);
    setIsLoading(true);

    try {
      const responseStream = await chatRef.current.sendMessageStream({ message: userText });
      
      setMessages((prev) => [...prev, { role: 'model', text: '' }]);
      
      let fullText = '';
      let functionCalls: any[] = [];

      for await (const chunk of responseStream) {
        if (chunk.functionCalls) {
          functionCalls.push(...chunk.functionCalls);
        }
        if (chunk.text) {
          fullText += chunk.text;
          setMessages((prev) => {
            const newMessages = [...prev];
            newMessages[newMessages.length - 1].text = fullText;
            return newMessages;
          });
        }
      }

      if (functionCalls.length > 0) {
        setMessages((prev) => {
          const newMessages = [...prev];
          newMessages[newMessages.length - 1].text = fullText + '\n\n*Buscando voos...*';
          return newMessages;
        });

        const functionResponses = await Promise.all(functionCalls.map(async (call) => {
          if (call.name === 'searchFlights') {
            try {
              const args = call.args as any;
              const res = await fetch('/api/flights', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  departure_id: args.departureAirport,
                  arrival_id: args.arrivalAirport,
                  outbound_date: args.date,
                  airline: args.preferredAirline
                })
              });
              const data = await res.json();
              return {
                functionResponse: {
                  name: call.name,
                  response: data
                }
              };
            } catch (e: any) {
              return {
                functionResponse: {
                  name: call.name,
                  response: { error: e.message }
                }
              };
            }
          }
          return {
            functionResponse: {
              name: call.name,
              response: { error: 'Unknown function' }
            }
          };
        }));

        const nextResponseStream = await chatRef.current.sendMessageStream(functionResponses);
        
        for await (const chunk of nextResponseStream) {
          if (chunk.text) {
            fullText += chunk.text;
            setMessages((prev) => {
              const newMessages = [...prev];
              newMessages[newMessages.length - 1].text = fullText;
              return newMessages;
            });
          }
        }
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setMessages((prev) => [
        ...prev,
        { role: 'model', text: 'Desculpe, ocorreu um erro ao processar sua solicitação. Por favor, tente novamente.' }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-screen bg-gray-50 font-sans">
      {/* Sidebar */}
      <div className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-6 border-b border-gray-200 flex items-center gap-3">
          <div className="bg-blue-600 p-2 rounded-lg text-white">
            <Plane size={24} />
          </div>
          <h1 className="text-xl font-bold text-gray-800">Viajantes</h1>
        </div>
        
        <div className="p-4 flex-1">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Modo de Operação</h2>
          
          <div className="space-y-2">
            <button
              onClick={() => setMode('search')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${
                mode === 'search' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'text-gray-600 hover:bg-gray-100 border border-transparent'
              }`}
            >
              <Globe size={18} className={mode === 'search' ? 'text-blue-600' : 'text-gray-400'} />
              <div className="text-left">
                <div className="text-sm font-medium">Pesquisa Web</div>
                <div className="text-xs opacity-80">Voos e informações gerais</div>
              </div>
            </button>
            
            <button
              onClick={() => setMode('maps')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${
                mode === 'maps' ? 'bg-green-50 text-green-700 border border-green-200' : 'text-gray-600 hover:bg-gray-100 border border-transparent'
              }`}
            >
              <Map size={18} className={mode === 'maps' ? 'text-green-600' : 'text-gray-400'} />
              <div className="text-left">
                <div className="text-sm font-medium">Google Maps</div>
                <div className="text-xs opacity-80">Hotéis e localizações</div>
              </div>
            </button>
            
            <button
              onClick={() => setMode('thinking')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${
                mode === 'thinking' ? 'bg-purple-50 text-purple-700 border border-purple-200' : 'text-gray-600 hover:bg-gray-100 border border-transparent'
              }`}
            >
              <Brain size={18} className={mode === 'thinking' ? 'text-purple-600' : 'text-gray-400'} />
              <div className="text-left">
                <div className="text-sm font-medium">Raciocínio Profundo</div>
                <div className="text-xs opacity-80">Roteiros complexos</div>
              </div>
            </button>
          </div>
        </div>
        
        <div className="p-4 border-t border-gray-200 text-xs text-gray-400 text-center">
          Powered by Gemini
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-white">
        {/* Header */}
        <header className="h-16 border-b border-gray-200 flex items-center px-6 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
          <h2 className="text-lg font-medium text-gray-800">
            {mode === 'search' && 'Assistente de Viagens (Pesquisa Web)'}
            {mode === 'maps' && 'Assistente de Viagens (Google Maps)'}
            {mode === 'thinking' && 'Assistente de Viagens (Planejamento Complexo)'}
          </h2>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-gray-50">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-4">
              <div className="bg-blue-100 p-4 rounded-full text-blue-600 mb-2">
                <Plane size={32} />
              </div>
              <h3 className="text-2xl font-semibold text-gray-800">Bem-vindo à Viajantes!</h3>
              <p className="text-gray-500">
                Sou seu agente de viagens pessoal. Me diga para onde você quer ir, quando e qual o seu orçamento, e eu cuidarei do resto.
              </p>
            </div>
          ) : (
            messages.map((msg, index) => (
              <div
                key={index}
                className={`flex gap-4 max-w-3xl mx-auto ${
                  msg.role === 'user' ? 'flex-row-reverse' : ''
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                    msg.role === 'user'
                      ? 'bg-gray-800 text-white'
                      : 'bg-blue-600 text-white'
                  }`}
                >
                  {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                </div>
                <div
                  className={`px-5 py-4 rounded-2xl max-w-[80%] shadow-sm ${
                    msg.role === 'user'
                      ? 'bg-gray-800 text-white rounded-tr-none'
                      : 'bg-white border border-gray-100 rounded-tl-none text-gray-800'
                  }`}
                >
                  {msg.role === 'user' ? (
                    <div className="whitespace-pre-wrap">{msg.text}</div>
                  ) : (
                    <div className="markdown-body prose prose-sm max-w-none prose-p:leading-relaxed prose-a:text-blue-600">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.text || '...'}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          {isLoading && messages.length > 0 && messages[messages.length - 1].role === 'user' && (
            <div className="flex gap-4 max-w-3xl mx-auto">
              <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0">
                <Bot size={16} />
              </div>
              <div className="px-5 py-4 rounded-2xl bg-white border border-gray-100 rounded-tl-none text-gray-800 flex items-center gap-2 shadow-sm">
                <Loader2 size={16} className="animate-spin text-blue-600" />
                <span className="text-sm text-gray-500">
                  {mode === 'search' && 'Pesquisando opções...'}
                  {mode === 'maps' && 'Buscando locais...'}
                  {mode === 'thinking' && 'Elaborando o roteiro...'}
                </span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 bg-white border-t border-gray-200">
          <div className="max-w-3xl mx-auto relative flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Digite sua mensagem aqui... (Ex: Quero ir para Paris em Julho)"
              className="w-full bg-gray-50 border border-gray-200 rounded-2xl py-3 px-4 pr-12 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none min-h-[56px] max-h-32"
              rows={1}
              disabled={isLoading}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className="absolute right-2 bottom-2 p-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 transition-colors"
            >
              <Send size={18} />
            </button>
          </div>
          <div className="text-center mt-2 text-xs text-gray-400">
            A Viajantes pode cometer erros. Verifique informações importantes.
          </div>
        </div>
      </div>
    </div>
  );
}
