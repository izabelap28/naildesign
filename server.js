const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const app = express();

// Configurações do Servidor
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json()); // Necessário para processar o JSON estruturado dos agendamentos
app.use(express.static('.')); // Serve as páginas HTML, CSS e imagens do projeto

// Conexão com o Novo Banco de Dados do Projeto
const db = new sqlite3.Database('./siscristovao.db');

// Serviços padrão (aparecem no select e preenchem valor + tempo)
const servicosPadrao = [
    { descricao: 'Alongamento em Gel', preco: 170, tempo_estimado: 150 },
    { descricao: 'Esmaltação em Gel', preco: 70, tempo_estimado: 90 },
    { descricao: 'Blindagem com Esmaltação em Gel', preco: 90, tempo_estimado: 90 },
    { descricao: 'Esmaltação Normal Pé e Mão', preco: 50, tempo_estimado: 60 },
    { descricao: 'Esmaltação Normal Mão', preco: 30, tempo_estimado: 30 },
    { descricao: 'Esmaltação Normal Pé', preco: 30, tempo_estimado: 30 },
    { descricao: 'Cabelo Corte com Escova', preco: 50, tempo_estimado: 30 },
    { descricao: 'Hidratação', preco: 60, tempo_estimado: 60 }
];

// Inicialização das Tabelas (Cria a estrutura caso não exista)
db.serialize(() => {
    // 1. Tabela de Clientes
    db.run(`CREATE TABLE IF NOT EXISTS clientes (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        nome TEXT NOT NULL, 
        cpf TEXT NOT NULL, 
        telefone TEXT NOT NULL
    )`);

    // 2. Tabela de Serviços
    db.run(`CREATE TABLE IF NOT EXISTS servicos (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        descricao TEXT NOT NULL, 
        preco REAL NOT NULL, 
        tempo_estimado INTEGER NOT NULL
    )`);

    // 3. Tabela Mestre: Agendamentos
    db.run(`CREATE TABLE IF NOT EXISTS agendamentos (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        cliente_id INTEGER NOT NULL, 
        data TEXT NOT NULL, 
        responsavel TEXT NOT NULL,
        total REAL NOT NULL,
        tempo_total INTEGER NOT NULL,
        FOREIGN KEY (cliente_id) REFERENCES clientes (id)
    )`);

    // 4. Tabela Detalhe: Itens do Agendamento
    db.run(`CREATE TABLE IF NOT EXISTS itens_agendamento (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        agendamento_id INTEGER NOT NULL, 
        servico_id INTEGER NOT NULL, 
        preco_cobrado REAL NOT NULL,
        FOREIGN KEY (agendamento_id) REFERENCES agendamentos (id),
        FOREIGN KEY (servico_id) REFERENCES servicos (id)
    )`);

    // Seed inteligente: insere cada serviço se ainda não existir (pelo nome)
    servicosPadrao.forEach(s => {
        db.get('SELECT id FROM servicos WHERE descricao = ?', [s.descricao], (err, row) => {
            if (err) {
                console.error('Erro ao verificar serviço:', err.message);
                return;
            }
            if (!row) {
                db.run(
                    'INSERT INTO servicos (descricao, preco, tempo_estimado) VALUES (?, ?, ?)',
                    [s.descricao, s.preco, s.tempo_estimado],
                    function (err2) {
                        if (err2) {
                            console.error('Erro ao inserir serviço:', err2.message);
                        } else {
                            console.log('✅ Serviço cadastrado:', s.descricao);
                        }
                    }
                );
            }
        });
    });
});

/* ==========================================================================
   ROTAS DO MÓDULO: CLIENTES
   ========================================================================== */

// Salvar um novo cliente
app.post('/salvar-cliente', (req, res) => {
    const { nome, cpf, telefone } = req.body;
    const sql = `INSERT INTO clientes (nome, cpf, telefone) VALUES (?, ?, ?)`;
    
    db.run(sql, [nome, cpf, telefone], (err) => {
        if (err) return res.status(500).send("Erro ao salvar cliente: " + err.message);
        res.redirect('/clientes.html');
    });
});

// Listar todos os clientes (API JSON)
app.get('/listar-clientes', (req, res) => {
    const sql = `SELECT * FROM clientes ORDER BY nome ASC`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

/* ==========================================================================
   ROTAS DO MÓDULO: SERVIÇOS
   ========================================================================== */

// Salvar um novo serviço no catálogo
app.post('/salvar-servico', (req, res) => {
    const { descricao, preco, tempo_estimado } = req.body;

    if (!descricao || preco === undefined || preco === '' || tempo_estimado === undefined || tempo_estimado === '') {
        return res.status(400).json({ success: false, error: 'Preencha todos os campos.' });
    }

    const sql = `INSERT INTO servicos (descricao, preco, tempo_estimado) VALUES (?, ?, ?)`;

    db.run(sql, [descricao, parseFloat(preco), parseInt(tempo_estimado)], function(err) {
        if (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
        res.json({ success: true, id: this.lastID });
    });
});

// Listar todos os serviços (API JSON)
app.get('/listar-servicos', (req, res) => {
    const sql = `SELECT * FROM servicos ORDER BY descricao ASC`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

/* ==========================================================================
   ROTAS DO MÓDULO: AGENDAMENTOS (TRANSAÇÃO MESTRE-DETALHE)
   ========================================================================== */

// Gravar Agendamento Completo (Mestre e Detalhes encapsulados)
app.post('/finalizar-agendamento', (req, res) => {
    const { cliente_id, nome_cliente, data, responsavel, total, tempo_total, servicos } = req.body;

    if (!data || !responsavel) {
        return res.status(400).json({ success: false, error: 'Data e responsável são obrigatórios.' });
    }
    if (!Array.isArray(servicos) || servicos.length === 0) {
        return res.status(400).json({ success: false, error: 'Adicione pelo menos um serviço.' });
    }

    function inserirItens(agendamentoId, lista, index, callback) {
        if (index >= lista.length) {
            return callback(null);
        }
        const item = lista[index];
        const servicoId = parseInt(item.id, 10);
        const preco = parseFloat(item.preco);

        if (!servicoId || isNaN(preco)) {
            return callback(new Error('Serviço inválido no agendamento.'));
        }

        db.run(
            `INSERT INTO itens_agendamento (agendamento_id, servico_id, preco_cobrado) VALUES (?, ?, ?)`,
            [agendamentoId, servicoId, preco],
            function (err) {
                if (err) return callback(err);
                inserirItens(agendamentoId, lista, index + 1, callback);
            }
        );
    }

    function salvarAgendamento(idCliente) {
        const sqlMestre = `INSERT INTO agendamentos (cliente_id, data, responsavel, total, tempo_total) VALUES (?, ?, ?, ?, ?)`;

        db.run(sqlMestre, [idCliente, data, responsavel, parseFloat(total) || 0, parseInt(tempo_total, 10) || 0], function (err) {
            if (err) {
                return res.status(500).json({ success: false, error: err.message });
            }

            const agendamentoId = this.lastID;

            inserirItens(agendamentoId, servicos, 0, (errItens) => {
                if (errItens) {
                    return res.status(500).json({ success: false, error: errItens.message });
                }
                res.json({ success: true, id: agendamentoId });
            });
        });
    }

    // Se veio o nome da cliente (campo texto), cadastra e depois agenda
    if (nome_cliente && String(nome_cliente).trim()) {
        const nome = String(nome_cliente).trim();
        const sqlCliente = `INSERT INTO clientes (nome, cpf, telefone) VALUES (?, ?, ?)`;
        db.run(sqlCliente, [nome, '-', '-'], function (err) {
            if (err) {
                return res.status(500).json({ success: false, error: err.message });
            }
            salvarAgendamento(this.lastID);
        });
        return;
    }

    // Compatibilidade com cliente_id antigo
    if (cliente_id) {
        salvarAgendamento(cliente_id);
        return;
    }

    return res.status(400).json({ success: false, error: 'Informe o nome da cliente.' });
});

// Listar todos os Agendamentos salvos
app.get('/listar-agendamentos', (req, res) => {
    const sql = `
        SELECT a.id, a.data, a.responsavel, a.total, a.tempo_total, c.nome as nome_cliente 
        FROM agendamentos a 
        INNER JOIN clientes c ON a.cliente_id = c.id 
        ORDER BY a.id DESC`;
        
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Listar serviços específicos de um agendamento
app.get('/detalhes-agendamento/:id', (req, res) => {
    const { id } = req.params;
    const sql = `
        SELECT i.preco_cobrado, s.descricao, s.tempo_estimado 
        FROM itens_agendamento i 
        INNER JOIN servicos s ON i.servico_id = s.id 
        WHERE i.agendamento_id = ?`;
        
    db.all(sql, [id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Inicialização do Servidor na Porta 3000
app.listen(3000, () => {
    console.log('====================================================');
    console.log('🚀 SisCristóvão Rodando com Sucesso na Porta 3000!');
    console.log('📂 Banco de Dados: siscristovao.db');
    console.log('====================================================');
});
